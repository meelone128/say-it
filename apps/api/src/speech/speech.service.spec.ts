import { ServiceUnavailableException } from '@nestjs/common';
import { SpeechService } from './speech.service';

describe('SpeechService', () => {
  const originalApiKey = process.env.DASHSCOPE_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.DASHSCOPE_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns one playable URL for each sentence in order', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          output: { audio: { url: `https://audio.test/${call}.mp3` } },
        }),
      };
    });

    const result = await new SpeechService().synthesize([
      'Hello.',
      'How are you?',
    ]);
    expect(result.audios).toHaveLength(2);
    expect(result.audios.map((audio) => audio.sequence)).toEqual([1, 2]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('queues a long unit one sentence at a time to respect provider limits', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    let call = 0;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          call += 1;
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({
                  output: { audio: { url: `https://audio.test/${call}.mp3` } },
                }),
              }),
            30,
          );
        }),
    );

    const startedAt = Date.now();
    await new SpeechService().synthesize(
      Array.from({ length: 10 }, (_, index) => `Sentence ${index + 1}.`),
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
  });

  it('retries a rate-limited sentence before returning its audio', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Requests rate limit exceeded' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: { audio: { url: 'https://audio.test/retried.mp3' } },
        }),
      });

    const result = await new SpeechService().synthesize(['Hello.']);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.audios[0].audioUrl).toBe('https://audio.test/retried.mp3');
  });

  it('upgrades DashScope audio links to HTTPS for Android downloads', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          audio: {
            url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.mp3',
          },
        },
      }),
    });

    const result = await new SpeechService().synthesize(['Hello.']);

    expect(result.audios[0].audioUrl).toBe(
      'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.mp3',
    );
  });

  it('requires the server-side API key', async () => {
    delete process.env.DASHSCOPE_API_KEY;
    await expect(
      new SpeechService().synthesize(['Hello.']),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
