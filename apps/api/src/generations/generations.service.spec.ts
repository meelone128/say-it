import { ServiceUnavailableException } from '@nestjs/common';
import { GenerationsService } from './generations.service';

describe('GenerationsService', () => {
  const originalApiKey = process.env.DASHSCOPE_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.DASHSCOPE_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a normalized bilingual sentence list', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sentences: [
                  {
                    sequence: 3,
                    english_text: "I'm not angry.",
                    chinese_meaning: '我不是生气。',
                  },
                  {
                    sequence: 9,
                    english_text: "I'm just a little disappointed.",
                    chinese_meaning: '我只是有点失望。',
                  },
                ],
                metadata: {},
              }),
            },
          },
        ],
      }),
    }) as jest.Mock;

    await expect(
      new GenerationsService().generate('我不是生气，我只是有点失望。'),
    ).resolves.toMatchObject({
      englishParagraph: "I'm not angry. I'm just a little disappointed.",
      sentences: [
        {
          sequence: 1,
          englishText: "I'm not angry.",
          chineseMeaning: '我不是生气。',
        },
        {
          sequence: 2,
          englishText: "I'm just a little disappointed.",
          chineseMeaning: '我只是有点失望。',
        },
      ],
      metadata: {
        promptVersion: 'spoken-en-v8',
      },
    });
  });

  it('requires the server-side API key', async () => {
    delete process.env.DASHSCOPE_API_KEY;
    await expect(
      new GenerationsService().generate('测试'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
