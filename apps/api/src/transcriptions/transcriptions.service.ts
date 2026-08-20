import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { extname } from 'node:path';

export interface AudioUpload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

interface DashScopeResponse {
  output?: {
    text?: string;
    sentence?: { text?: string };
  };
  code?: string;
  message?: string;
  request_id?: string;
}

const DEFAULT_MODEL = 'fun-asr-flash-2026-06-15';
const DEFAULT_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

@Injectable()
export class TranscriptionsService {
  async transcribe(audio: AudioUpload) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('语音识别服务尚未配置');
    }

    const format = getAudioFormat(audio.originalname, audio.mimetype);
    const mediaType = getMediaType(format);
    const model = process.env.DASHSCOPE_FUN_ASR_MODEL || DEFAULT_MODEL;
    const endpoint = process.env.DASHSCOPE_FUN_ASR_ENDPOINT || DEFAULT_ENDPOINT;
    const dataUri = `data:${mediaType};base64,${audio.buffer.toString('base64')}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-SSE': 'disable',
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'input_audio', input_audio: { data: dataUri } },
                ],
              },
            ],
          },
          parameters: {
            format,
            language_hints: ['zh'],
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new BadGatewayException('暂时无法连接语音识别服务，请稍后重试');
    }

    const body = (await response.json().catch(() => ({}))) as DashScopeResponse;
    if (!response.ok) {
      throw new BadGatewayException(
        body.message || '语音识别失败，请重新录制后再试',
      );
    }

    const transcript =
      body.output?.text?.trim() || body.output?.sentence?.text?.trim();
    if (!transcript) {
      throw new BadGatewayException('没有听清录音内容，请靠近麦克风重新录制');
    }

    return {
      transcript,
      provider: 'dashscope' as const,
      model,
    };
  }
}

function getAudioFormat(filename: string, mimetype: string) {
  const extension = extname(filename).toLowerCase().slice(1);
  if (['aac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'webm'].includes(extension)) {
    return extension;
  }

  const mimeFormats: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
  };
  return mimeFormats[mimetype] || 'm4a';
}

function getMediaType(format: string) {
  const mediaTypes: Record<string, string> = {
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    webm: 'audio/webm',
  };
  return mediaTypes[format] || 'application/octet-stream';
}
