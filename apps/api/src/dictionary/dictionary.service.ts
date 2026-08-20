import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

interface ProviderResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  message?: string;
}

interface RawDictionaryEntry {
  word?: unknown;
  phonetic?: unknown;
  part_of_speech?: unknown;
  meaning?: unknown;
  spoken_note?: unknown;
  example?: unknown;
  example_chinese?: unknown;
}

const DEFAULT_MODEL = 'qwen3-max';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

@Injectable()
export class DictionaryService {
  async explain(word: string, sentence: string) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('单词解释服务尚未配置');
    }

    let response: Response;
    try {
      response = await fetch(`${process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.DASHSCOPE_TEXT_MODEL || DEFAULT_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are a concise English speaking coach for Chinese learners. Return JSON only. Explain the selected word as it is used in the provided everyday spoken sentence. Prefer the most natural, common spoken meaning. Never use textbook language, exam labels, or long explanations. Required JSON: {"word":"","phonetic":"","part_of_speech":"","meaning":"","spoken_note":"","example":"","example_chinese":""}. All fields must be short strings. meaning, spoken_note and example_chinese must be Simplified Chinese.',
            },
            {
              role: 'user',
              content: JSON.stringify({ word, sentence }),
            },
          ],
          response_format: { type: 'json_object' },
          enable_thinking: false,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new BadGatewayException('暂时无法连接单词解释服务，请稍后重试');
    }

    const body = (await response.json().catch(() => ({}))) as ProviderResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        body.error?.message || body.message || '单词解释生成失败，请稍后重试',
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new BadGatewayException('单词解释为空，请重新点击');

    try {
      return normalizeEntry(JSON.parse(content) as RawDictionaryEntry, word);
    } catch {
      throw new BadGatewayException('单词解释格式异常，请重新点击');
    }
  }
}

function normalizeEntry(entry: RawDictionaryEntry, fallbackWord: string) {
  const get = (value: unknown) =>
    typeof value === 'string' ? value.trim().slice(0, 220) : '';
  const result = {
    word: get(entry.word) || fallbackWord,
    phonetic: get(entry.phonetic),
    partOfSpeech: get(entry.part_of_speech),
    meaning: get(entry.meaning),
    spokenNote: get(entry.spoken_note),
    example: get(entry.example),
    exampleChinese: get(entry.example_chinese),
  };
  if (!result.meaning) throw new Error('missing meaning');
  return result;
}
