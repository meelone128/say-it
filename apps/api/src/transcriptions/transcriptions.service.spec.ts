import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  TranscriptionsService,
  type AudioUpload,
} from './transcriptions.service';

const audio: AudioUpload = {
  buffer: Buffer.from('audio-content'),
  mimetype: 'audio/mp4',
  originalname: 'recording.m4a',
};

describe('TranscriptionsService', () => {
  const originalApiKey = process.env.DASHSCOPE_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.DASHSCOPE_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the recognized Chinese transcript', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: { text: '我想在九点之前到达。' } }),
    }) as jest.Mock;

    await expect(
      new TranscriptionsService().transcribe(audio),
    ).resolves.toMatchObject({
      transcript: '我想在九点之前到达。',
      provider: 'dashscope',
    });

    const request = (global.fetch as jest.Mock).mock.calls[0][1];
    const payload = JSON.parse(request.body as string);
    expect(payload.parameters).toEqual({
      format: 'm4a',
      language_hints: ['zh'],
    });
    expect(payload.input.messages[0].content[0].input_audio.data).toMatch(
      /^data:audio\/mp4;base64,/,
    );
  });

  it('requires a server-side API key', async () => {
    delete process.env.DASHSCOPE_API_KEY;
    await expect(
      new TranscriptionsService().transcribe(audio),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects an empty provider result', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: {} }),
    }) as jest.Mock;

    await expect(
      new TranscriptionsService().transcribe(audio),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
