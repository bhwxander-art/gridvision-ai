interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetches a URL and returns the parsed JSON response.
 * Retries on network failures and HTTP 5xx responses using exponential backoff.
 * Does NOT retry on HTTP 4xx (client errors) or AbortErrors.
 *
 * Delays: 400 ms → 800 ms → 1 600 ms (for maxAttempts=3)
 */
export async function fetchWithRetry<T>(
  url: string,
  {
    maxAttempts = 3,
    baseDelayMs = 400,
    signal,
  }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { signal });

      if (res.ok) {
        return (await res.json()) as T;
      }

      // 4xx — client error, do not retry
      if (res.status >= 400 && res.status < 500) {
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          retryable: false,
        });
      }

      // 5xx — server error, retryable
      lastError = Object.assign(new Error(`HTTP ${res.status}`), {
        retryable: true,
      });
    } catch (err) {
      // Abort is never retried
      if (err instanceof DOMException && err.name === "AbortError") throw err;

      // Non-retryable errors bubble immediately
      if (
        err instanceof Error &&
        (err as Error & { retryable?: boolean }).retryable === false
      ) {
        throw err;
      }

      lastError = err;
    }

    // Wait before next attempt (skip delay on final attempt)
    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt)
      );
    }
  }

  throw lastError ?? new Error("fetchWithRetry: all attempts exhausted");
}
