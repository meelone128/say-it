import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');
const resultsRoot = join(workspaceRoot, 'evaluation', 'results');
const apiKey = process.env.DASHSCOPE_API_KEY;
const endpoint = process.env.DASHSCOPE_TTS_ENDPOINT
  ?? 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const model = process.env.DASHSCOPE_TTS_MODEL ?? 'cosyvoice-v3-flash';

if (!apiKey) {
  console.error('Missing DASHSCOPE_API_KEY. Fill it in .env.local.');
  process.exit(1);
}

const sampleText = "I'm really happy for you. All your hard work finally paid off.";
const voices = [
  { id: 'loongabby_v3', label: 'American female' },
  { id: 'longanyang', label: 'Young bilingual male' },
  { id: 'longanhuan', label: 'Energetic bilingual female' }
];
const runId = `tts-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
const runDirectory = join(resultsRoot, runId);
await mkdir(runDirectory, { recursive: true });

const summaries = [];

for (const voice of voices) {
  process.stdout.write(`Generating ${voice.id}... `);
  const startedAt = performance.now();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: {
          text: sampleText,
          voice: voice.id,
          format: 'wav',
          sample_rate: 24000
        }
      }),
      signal: AbortSignal.timeout(90_000)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body?.message ?? body?.error?.message ?? 'Unknown provider error'}`);
    }

    const audioUrl = body?.output?.audio?.url ?? body?.output?.url;
    if (typeof audioUrl !== 'string') {
      throw new Error('Provider response did not contain an audio URL.');
    }

    const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(90_000) });
    if (!audioResponse.ok) throw new Error(`Audio download failed with HTTP ${audioResponse.status}.`);
    const audio = new Uint8Array(await audioResponse.arrayBuffer());
    const outputPath = join(runDirectory, `${voice.id}.wav`);
    await writeFile(outputPath, audio);

    const latencyMs = Math.round(performance.now() - startedAt);
    summaries.push({ voice: voice.id, label: voice.label, passed: true, latency_ms: latencyMs, bytes: audio.length });
    console.log(`saved (${latencyMs} ms, ${audio.length} bytes)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summaries.push({ voice: voice.id, label: voice.label, passed: false, error: message });
    console.log(`failed: ${message}`);
  }
}

await writeFile(
  join(runDirectory, 'summary.json'),
  `${JSON.stringify({ run_id: runId, model, text: sampleText, voices: summaries }, null, 2)}\n`,
  'utf8'
);

console.log(`Results: ${runDirectory}`);
if (summaries.some((item) => !item.passed)) process.exitCode = 1;
