import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  fetchProviderWithRetry,
  ProviderRateLimitError,
} from '../common/provider-retry';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface ProviderResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  message?: string;
}

interface RawSentence {
  sequence?: unknown;
  english_text?: unknown;
  chinese_meaning?: unknown;
}

interface RawGeneration {
  sentences?: unknown;
  metadata?: unknown;
}

export interface GeneratedSentence {
  sequence: number;
  englishText: string;
  chineseMeaning: string;
}

const DEFAULT_MODEL = 'qwen3-max';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

@Injectable()
export class GenerationsService {
  async generate(sourceTranscript: string) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('英语生成服务尚未配置');
    }

    const prompt = await loadPrompt();
    const model = process.env.DASHSCOPE_TEXT_MODEL || DEFAULT_MODEL;
    const baseUrl = process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL;

    let response: Response;
    try {
      response = await fetchProviderWithRetry(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: prompt.system },
            {
              role: 'user',
              content: prompt.userTemplate.replace(
                '{{source_transcript}}',
                sourceTranscript,
              ),
            },
          ],
          response_format: { type: 'json_object' },
          enable_thinking: false,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        throw new ServiceUnavailableException(
          '英语生成服务当前较忙，已自动重试。请等待几秒后再试。',
        );
      }
      throw new BadGatewayException('暂时无法连接英语生成服务，请稍后重试');
    }

    const body = (await response.json().catch(() => ({}))) as ProviderResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        body.error?.message || body.message || '英语生成失败，请稍后重试',
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new BadGatewayException('英语生成结果为空，请重新生成');
    }

    let raw: RawGeneration;
    try {
      raw = JSON.parse(content) as RawGeneration;
    } catch {
      throw new BadGatewayException('英语生成结果格式异常，请重新生成');
    }

    const sentences = normalizeSentences(raw.sentences);
    if (!sentences.length) {
      throw new BadGatewayException('没有生成可学习的英语句子，请重新生成');
    }

    return {
      sourceTranscript,
      englishParagraph: sentences
        .map((sentence) => sentence.englishText)
        .join(' '),
      sentences,
      metadata: {
        style: 'AMERICAN_DAILY_SPOKEN' as const,
        difficulty: 'EVERYDAY_INTERMEDIATE' as const,
        promptVersion: 'spoken-en-v8' as const,
        model,
      },
    };
  }
}

async function loadPrompt() {
  const path = resolve(
    process.cwd(),
    '../../evaluation/prompts/spoken-en-v8.md',
  );
  const markdown = await readFile(path, 'utf8');
  const systemMarker = '## System message';
  const userMarker = '## User message template';
  const systemStart = markdown.indexOf(systemMarker);
  const userStart = markdown.indexOf(userMarker);

  if (systemStart < 0 || userStart <= systemStart) {
    throw new ServiceUnavailableException('英语生成规则没有正确加载');
  }

  return {
    system: markdown.slice(systemStart + systemMarker.length, userStart).trim(),
    userTemplate: markdown.slice(userStart + userMarker.length).trim(),
  };
}

function normalizeSentences(value: unknown): GeneratedSentence[] {
  if (!Array.isArray(value)) return [];

  const sentences = value
    .map((item) => normalizeSentence(item as RawSentence))
    .filter(
      (item): item is Omit<GeneratedSentence, 'sequence'> => item !== null,
    )
    .slice(0, 30);

  return sentences.map((sentence, index) => ({
    sequence: index + 1,
    ...sentence,
  }));
}

function normalizeSentence(sentence: RawSentence) {
  if (!sentence || typeof sentence !== 'object') return null;
  if (
    typeof sentence.english_text !== 'string' ||
    typeof sentence.chinese_meaning !== 'string'
  ) {
    return null;
  }

  const englishText = sentence.english_text.trim();
  const chineseMeaning = sentence.chinese_meaning.trim();
  if (!englishText || !chineseMeaning || !/[.!?]["'”’]?$/.test(englishText))
    return null;

  return { englishText, chineseMeaning };
}
