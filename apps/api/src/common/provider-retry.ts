export class ProviderRateLimitError extends Error {
  constructor() {
    super('Provider rate limit exceeded');
  }
}

const RETRY_DELAYS_MS = [1_000, 2_000] as const;

/** Sends one provider request at a time and retries temporary 429 responses. */
export async function fetchProviderWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 429) return response;

    const retryDelay = RETRY_DELAYS_MS[attempt];
    if (retryDelay) {
      await delay(retryDelay);
      continue;
    }
  }

  throw new ProviderRateLimitError();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
