import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '..', '..');
const casesPath = join(workspaceRoot, 'evaluation', 'cases', 'zh-to-spoken-en.json');
const promptPath = join(workspaceRoot, 'evaluation', 'prompts', 'spoken-en-v7.md');
const resultsRoot = join(workspaceRoot, 'evaluation', 'results');

const apiKey = process.env.DASHSCOPE_API_KEY;
const baseUrl = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const model = process.env.DASHSCOPE_TEXT_MODEL ?? 'qwen3-max';

if (!apiKey) {
  console.error('Missing DASHSCOPE_API_KEY. Copy .env.example to .env.local and fill in the key locally.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const all = args.has('--all');
const limitArg = [...args].find((arg) => arg.startsWith('--limit='));
const caseArg = [...args].find((arg) => arg.startsWith('--case='));
const casesArg = [...args].find((arg) => arg.startsWith('--cases='));
const requestedLimit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 1;
const requestedCase = caseArg?.split('=')[1];
const requestedCases = casesArg?.split('=')[1].split(',').filter(Boolean);

if (!all && (!Number.isInteger(requestedLimit) || requestedLimit < 1)) {
  console.error('Use --limit=<positive integer>, --case=<case id>, or --all.');
  process.exit(1);
}

const [casesText, promptText] = await Promise.all([
  readFile(casesPath, 'utf8'),
  readFile(promptPath, 'utf8')
]);

const cases = JSON.parse(casesText);
const prompt = parsePrompt(promptText);
let selectedCases = requestedCases
  ? cases.filter((item) => requestedCases.includes(item.id))
  : requestedCase
    ? cases.filter((item) => item.id === requestedCase)
  : all
    ? cases
    : cases.slice(0, requestedLimit);

if (selectedCases.length === 0) {
  console.error(`No evaluation case found for: ${requestedCases?.join(',') ?? requestedCase}`);
  process.exit(1);
}

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDirectory = join(resultsRoot, runId);
await mkdir(runDirectory, { recursive: true });

const summaries = [];

for (const testCase of selectedCases) {
  process.stdout.write(`Running ${testCase.id}... `);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt.system },
          {
            role: 'user',
            content: prompt.userTemplate.replace('{{source_transcript}}', testCase.chinese)
          }
        ],
        response_format: { type: 'json_object' },
        enable_thinking: false,
        temperature: 0,
        stream: false
      }),
      signal: AbortSignal.timeout(90_000)
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const responseBody = await response.json();

    if (!response.ok) {
      throw new Error(`DashScope HTTP ${response.status}: ${safeProviderMessage(responseBody)}`);
    }

    const rawContent = responseBody?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string') {
      throw new Error('Provider response did not contain choices[0].message.content.');
    }

    let rawOutput;
    try {
      rawOutput = JSON.parse(rawContent);
    } catch {
      throw new Error('Model returned content that is not valid JSON.');
    }

    const normalization = normalizeLearningUnitOutput(rawOutput);
    const output = normalization.output;
    const validation = validateLearningUnitOutput(output);
    validation.warnings.unshift(...normalization.actions);
    const derivedEnglishParagraph = Array.isArray(output.sentences)
      ? output.sentences.map((sentence) => sentence.english_text).filter(isNonEmptyString).join(' ')
      : null;
    const result = {
      case_id: testCase.id,
      model,
      latency_ms: latencyMs,
      passed: validation.errors.length === 0,
      validation,
      usage: responseBody.usage ?? null,
      input: testCase,
      raw_output: rawOutput,
      output,
      derived_english_paragraph: derivedEnglishParagraph
    };

    await writeFile(
      join(runDirectory, `${testCase.id}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8'
    );

    summaries.push({
      case_id: testCase.id,
      passed: result.passed,
      latency_ms: latencyMs,
      errors: validation.errors
    });

    console.log(result.passed ? `passed (${latencyMs} ms)` : `failed validation (${latencyMs} ms)`);
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    summaries.push({ case_id: testCase.id, passed: false, latency_ms: latencyMs, errors: [message] });
    await writeFile(
      join(runDirectory, `${testCase.id}.error.json`),
      `${JSON.stringify({ case_id: testCase.id, model, latency_ms: latencyMs, error: message }, null, 2)}\n`,
      'utf8'
    );
    console.log(`error (${latencyMs} ms)`);
  }
}

const summary = {
  run_id: runId,
  model,
  total: summaries.length,
  passed: summaries.filter((item) => item.passed).length,
  failed: summaries.filter((item) => !item.passed).length,
  average_latency_ms: Math.round(
    summaries.reduce((total, item) => total + item.latency_ms, 0) / summaries.length
  ),
  cases: summaries
};

await writeFile(join(runDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Summary: ${summary.passed}/${summary.total} passed. Results: ${runDirectory}`);

function parsePrompt(markdown) {
  const systemMarker = '## System message';
  const userMarker = '## User message template';
  const systemStart = markdown.indexOf(systemMarker);
  const userStart = markdown.indexOf(userMarker);

  if (systemStart < 0 || userStart < 0 || userStart <= systemStart) {
    throw new Error('Prompt file is missing the expected section headings.');
  }

  return {
    system: markdown.slice(systemStart + systemMarker.length, userStart).trim(),
    userTemplate: markdown.slice(userStart + userMarker.length).trim()
  };
}

function validateLearningUnitOutput(output) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(output)) {
    return { errors: ['Output must be a JSON object.'], warnings };
  }

  const allowedRootKeys = new Set([
    'sentences',
    'metadata'
  ]);
  for (const key of Object.keys(output)) {
    if (!allowedRootKeys.has(key)) errors.push(`Unexpected root field: ${key}`);
  }

  if (!Array.isArray(output.sentences) || output.sentences.length === 0) {
    errors.push('sentences must be a non-empty array.');
  } else {
    output.sentences.forEach((sentence, index) => {
      if (!isPlainObject(sentence)) {
        errors.push(`sentences[${index}] must be an object.`);
        return;
      }
      if (sentence.sequence !== index + 1) {
        errors.push(`sentences[${index}].sequence must equal ${index + 1}.`);
      }
      if (!isNonEmptyString(sentence.english_text)) {
        errors.push(`sentences[${index}].english_text must be non-empty.`);
      } else {
        if (!/^["'“‘]?[A-Z]/.test(sentence.english_text.trim())) {
          errors.push(`sentences[${index}].english_text must start with an uppercase letter.`);
        }
        if (!/[.!?]["'”’]?$/.test(sentence.english_text.trim())) {
          errors.push(`sentences[${index}].english_text must end with sentence-final punctuation.`);
        }
        if (/happy for (?:you|him|her|them|us) (?:hearing|to hear)\b/i.test(sentence.english_text)) {
          errors.push(`sentences[${index}].english_text contains an invalid "happy for ... hearing/to hear" construction.`);
        }
        if (/\b(?:I|you|he|she|it|we|they|this|that|there)\b[^.!?]*,\s*(?:I|you|he|she|it|we|they|this|that|there)(?:'|\b)/i.test(sentence.english_text)) {
          warnings.push(`sentences[${index}].english_text may contain a comma splice; review manually.`);
        }
      }
      if (!isNonEmptyString(sentence.chinese_meaning)) {
        errors.push(`sentences[${index}].chinese_meaning must be non-empty.`);
      }
      const allowedSentenceKeys = new Set(['sequence', 'english_text', 'chinese_meaning']);
      for (const key of Object.keys(sentence)) {
        if (!allowedSentenceKeys.has(key)) errors.push(`Unexpected field in sentences[${index}]: ${key}`);
      }
    });

  }

  if (!isPlainObject(output.metadata)) {
    errors.push('metadata must be an object.');
  } else {
    if (output.metadata.style !== 'AMERICAN_DAILY_SPOKEN') {
      errors.push('metadata.style must be AMERICAN_DAILY_SPOKEN.');
    }
    if (output.metadata.difficulty !== 'EVERYDAY_INTERMEDIATE') {
      errors.push('metadata.difficulty must be EVERYDAY_INTERMEDIATE.');
    }
    if (output.metadata.prompt_version !== 'spoken-en-v7') {
      errors.push('metadata.prompt_version must be spoken-en-v7.');
    }
    const allowedMetadataKeys = new Set(['style', 'difficulty', 'prompt_version']);
    for (const key of Object.keys(output.metadata)) {
      if (!allowedMetadataKeys.has(key)) errors.push(`Unexpected metadata field: ${key}`);
    }
  }

  if (output.sentences?.length > 12) {
    warnings.push('More than 12 sentences may feel fragmented for a 60-second learning unit.');
  }

  return { errors, warnings };
}

function normalizeLearningUnitOutput(rawOutput) {
  if (!isPlainObject(rawOutput) || !Array.isArray(rawOutput.sentences)) {
    return { output: rawOutput, actions: [] };
  }

  const normalizedSentences = [];
  const actions = [];
  let pending = null;

  for (const source of rawOutput.sentences) {
    if (!isPlainObject(source)) {
      normalizedSentences.push(source);
      continue;
    }

    const fragment = {
      sequence: source.sequence,
      english_text: typeof source.english_text === 'string' ? source.english_text.trim() : source.english_text,
      chinese_meaning: typeof source.chinese_meaning === 'string' ? source.chinese_meaning.trim() : source.chinese_meaning
    };

    const startsLowercase = typeof fragment.english_text === 'string'
      && /^["'“‘]?[a-z]/.test(fragment.english_text);

    if (!pending && startsLowercase && normalizedSentences.length > 0) {
      pending = normalizedSentences.pop();
      actions.push(`Merged lowercase sentence fragment originally at sequence ${source.sequence}.`);
    }

    if (!pending) {
      pending = fragment;
    } else if (pending !== fragment) {
      pending = {
        ...pending,
        english_text: joinFragments(pending.english_text, fragment.english_text, ' '),
        chinese_meaning: joinFragments(pending.chinese_meaning, fragment.chinese_meaning, '')
      };
      actions.push(`Merged non-final sentence fragment with sequence ${source.sequence}.`);
    }

    if (typeof pending.english_text === 'string' && /[.!?]["'”’]?$/.test(pending.english_text)) {
      normalizedSentences.push(pending);
      pending = null;
    }
  }

  if (pending) normalizedSentences.push(pending);

  return {
    output: {
      ...rawOutput,
      sentences: normalizedSentences.map((sentence, index) => ({
        ...sentence,
        sequence: index + 1
      }))
    },
    actions
  };
}

function safeProviderMessage(body) {
  return body?.error?.message ?? body?.message ?? 'Unknown provider error';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function joinFragments(left, right, separator) {
  if (typeof left !== 'string' || typeof right !== 'string') return left;
  return `${left.trimEnd()}${separator}${right.trimStart()}`;
}
