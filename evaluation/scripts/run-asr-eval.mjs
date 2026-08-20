import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, parse, resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');
const casesPath = join(workspaceRoot, 'evaluation', 'cases', 'zh-to-spoken-en.json');
const resultsRoot = join(workspaceRoot, 'evaluation', 'results');
const audioDirArg = process.argv.find((arg) => arg.startsWith('--audio-dir='));
const providerArg = process.argv.find((arg) => arg.startsWith('--provider='));
const retest = process.argv.includes('--retest');
const audioDirectory = resolve(audioDirArg?.slice('--audio-dir='.length) ?? 'D:\\QQFiles');
const selectedProviders = providerArg ? [providerArg.slice('--provider='.length)] : ['qwen', 'fun'];

if (selectedProviders.some((provider) => !['qwen', 'fun'].includes(provider))) {
  console.error('Use --provider=qwen or --provider=fun.');
  process.exit(1);
}

const apiKey = process.env.DASHSCOPE_API_KEY;
const compatibleBaseUrl = process.env.DASHSCOPE_BASE_URL
  ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const qwenModel = process.env.DASHSCOPE_QWEN_ASR_MODEL ?? 'qwen3-asr-flash';
const funModel = process.env.DASHSCOPE_FUN_ASR_MODEL ?? 'fun-asr-flash-2026-06-15';
const funEndpoint = process.env.DASHSCOPE_FUN_ASR_ENDPOINT
  ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

if (!apiKey) {
  console.error('Missing DASHSCOPE_API_KEY. Fill it in .env.local.');
  process.exit(1);
}

const fullEvaluationIds = [
  'daily-001', 'daily-005', 'request-003', 'request-005', 'emotion-002',
  'emotion-004', 'work-004', 'number-002', 'number-004', 'spoken-003'
];
const retestIds = ['emotion-002', 'emotion-004', 'number-004'];
const wantedIds = new Set(retest ? retestIds : fullEvaluationIds);
const cases = JSON.parse(await readFile(casesPath, 'utf8'));
const references = new Map(cases.filter((item) => wantedIds.has(item.id)).map((item) => [item.id, item.chinese]));
const directoryEntries = await readdir(audioDirectory, { withFileTypes: true });
const audioFiles = new Map();

for (const entry of directoryEntries) {
  if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.mp3') continue;
  const id = retest ? normalizeRetestId(parse(entry.name).name) : normalizeAudioId(parse(entry.name).name);
  if (wantedIds.has(id)) audioFiles.set(id, join(audioDirectory, entry.name));
}

const missing = [...wantedIds].filter((id) => !audioFiles.has(id));
if (missing.length > 0) {
  console.error(`Missing recordings: ${missing.join(', ')}`);
  process.exit(1);
}

const runId = `asr-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
const runDirectory = join(resultsRoot, runId);
await mkdir(runDirectory, { recursive: true });
const results = [];

for (const id of wantedIds) {
  const filePath = audioFiles.get(id);
  const audio = await readFile(filePath);
  const dataUri = `data:audio/mpeg;base64,${audio.toString('base64')}`;
  const reference = references.get(id);

  for (const provider of selectedProviders) {
    process.stdout.write(`Running ${provider} ${id}... `);
    const startedAt = performance.now();
    try {
      const transcript = provider === 'qwen'
        ? await transcribeQwen(dataUri)
        : await transcribeFun(dataUri);
      const latencyMs = Math.round(performance.now() - startedAt);
      const score = characterErrorRate(reference, transcript);
      const result = {
        case_id: id,
        provider,
        model: provider === 'qwen' ? qwenModel : funModel,
        source_file: parse(filePath).base,
        reference,
        transcript,
        normalized_reference: normalizeChinese(reference),
        normalized_transcript: normalizeChinese(transcript),
        character_errors: score.distance,
        reference_characters: score.referenceLength,
        cer: score.rate,
        latency_ms: latencyMs,
        passed: true
      };
      results.push(result);
      await writeFile(join(runDirectory, `${id}.${provider}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(`CER ${(score.rate * 100).toFixed(2)}% (${latencyMs} ms)`);
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      const result = { case_id: id, provider, model: provider === 'qwen' ? qwenModel : funModel, passed: false, latency_ms: latencyMs, error: message };
      results.push(result);
      await writeFile(join(runDirectory, `${id}.${provider}.error.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(`failed: ${message}`);
    }
  }
}

const providers = selectedProviders.map((provider) => {
  const items = results.filter((item) => item.provider === provider);
  const passed = items.filter((item) => item.passed);
  const totalErrors = passed.reduce((sum, item) => sum + item.character_errors, 0);
  const totalReference = passed.reduce((sum, item) => sum + item.reference_characters, 0);
  return {
    provider,
    model: passed[0]?.model ?? items[0]?.model,
    passed: passed.length,
    total: items.length,
    aggregate_cer: totalReference === 0 ? null : totalErrors / totalReference,
    average_latency_ms: passed.length === 0 ? null : Math.round(passed.reduce((sum, item) => sum + item.latency_ms, 0) / passed.length)
  };
});

await writeFile(join(runDirectory, 'summary.json'), `${JSON.stringify({ run_id: runId, providers, cases: results }, null, 2)}\n`, 'utf8');
console.log(`Results: ${runDirectory}`);

async function transcribeQwen(dataUri) {
  const response = await fetch(`${compatibleBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: qwenModel,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }],
      asr_options: { language: 'zh', enable_itn: true },
      stream: false
    }),
    signal: AbortSignal.timeout(90_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeMessage(body)}`);
  const transcript = body?.choices?.[0]?.message?.content;
  if (typeof transcript !== 'string' || transcript.trim() === '') throw new Error('Qwen response did not contain transcript text.');
  return transcript.trim();
}

async function transcribeFun(dataUri) {
  const response = await fetch(funEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
    body: JSON.stringify({
      model: funModel,
      input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }] },
      parameters: { format: 'mp3' }
    }),
    signal: AbortSignal.timeout(90_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeMessage(body)}`);
  const transcript = body?.output?.output?.sentence?.text ?? body?.output?.text;
  if (typeof transcript !== 'string' || transcript.trim() === '') throw new Error('Fun-ASR response did not contain transcript text.');
  return transcript.trim();
}

function normalizeAudioId(name) {
  return name.replace(/[‐‑‒–—−]/g, '-').replace(/\(\d+\)$/u, '').toLowerCase();
}

function normalizeRetestId(name) {
  const match = name.match(/^标准录音\s*([123])/u);
  return match ? retestIds[Number.parseInt(match[1], 10) - 1] : '';
}

function normalizeChinese(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
}

function characterErrorRate(reference, hypothesis) {
  const left = [...normalizeChinese(reference)];
  const right = [...normalizeChinese(hypothesis)];
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return { distance: previous[right.length], referenceLength: left.length, rate: left.length === 0 ? 0 : previous[right.length] / left.length };
}

function safeMessage(body) {
  return body?.message ?? body?.error?.message ?? body?.code ?? 'Unknown provider error';
}
