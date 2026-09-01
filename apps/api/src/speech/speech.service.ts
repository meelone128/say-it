import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  fetchProviderWithRetry,
  ProviderRateLimitError,
} from '../common/provider-retry';

interface DashScopeSpeechResponse {
  output?: {
    audio?: { url?: string };
    url?: string;
  };
  message?: string;
  error?: { message?: string };
}

const DEFAULT_MODEL = 'cosyvoice-v3-flash';
const DEFAULT_VOICE = 'loongabby_v3';
const DEFAULT_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

@Injectable()
export class SpeechService {
  async synthesize(sentences: string[]) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('英语发音服务尚未配置');
    }

    const model = process.env.DASHSCOPE_TTS_MODEL || DEFAULT_MODEL;
    const voice = process.env.DASHSCOPE_TTS_VOICE || DEFAULT_VOICE;
    const endpoint = process.env.DASHSCOPE_TTS_ENDPOINT || DEFAULT_ENDPOINT;
    const audios = [];
    for (const [index, text] of sentences.entries()) {
      audios.push({
        sequence: index + 1,
        audioUrl: await this.synthesizeOne({
          apiKey,
          endpoint,
          model,
          voice,
          text,
        }),
      });
    }

    return { audios, model, voice };
  }

  private async synthesizeOne(options: {
    apiKey: string;
    endpoint: string;
    model: string;
    voice: string;
    text: string;
  }) {
    let response: Response;
    try {
      response = await fetchProviderWithRetry(options.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          input: {
            text: options.text,
            voice: options.voice,
            format: 'mp3',
            sample_rate: 24000,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        throw new ServiceUnavailableException(
          '英语发音服务当前较忙，已自动重试。请等待几秒后再试。',
        );
      }
      throw new BadGatewayException('暂时无法连接英语发音服务，请稍后重试');
    }

    const body = (await response
      .json()
      .catch(() => ({}))) as DashScopeSpeechResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        body.message || body.error?.message || '英语发音生成失败，请稍后重试',
      );
    }

    const audioUrl = body.output?.audio?.url || body.output?.url;
    if (!audioUrl) {
      throw new BadGatewayException('英语发音结果为空，请重新生成');
    }
    return makeAudioUrlSecure(audioUrl);
  }
}

/**
 * DashScope may return a temporary OSS file URL using HTTP. Android blocks
 * clear-text downloads, while this OSS endpoint also supports HTTPS.
 */
function makeAudioUrlSecure(audioUrl: string): string {
  try {
    const url = new URL(audioUrl);
    if (url.protocol === 'http:' && url.hostname.endsWith('.aliyuncs.com')) {
      url.protocol = 'https:';
    }
    return url.toString();
  } catch {
    return audioUrl;
  }
}
