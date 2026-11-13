import "server-only";

/**
 * Google Gemini (AI Studio) client.
 *
 * The Gemini Developer API free tier needs no credit card and has far
 * higher quotas than OpenRouter's free-model pool, which is capped at 50
 * requests per day on a zero-credit account.
 *
 * Get a key at https://aistudio.google.com/apikey
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export type GeminiFetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  apiKey: string;
};

export async function geminiFetch<T>(
  path: string,
  options: GeminiFetchOptions,
): Promise<T> {
  const response = await fetch(`${GEMINI_BASE_URL}${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GeminiError(
      `Gemini request failed (${response.status}) for ${path}: ${text.slice(0, 500)}`,
      response.status,
      text,
    );
  }

  return (await response.json()) as T;
}

/**
 * Retries transient failures with exponential backoff.
 *
 * 429 (rate limit) and 5xx are worth retrying; 400-class errors are not.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 4,
    baseDelayMs = 1000,
    isRetryable = (error: unknown) =>
      error instanceof GeminiError &&
      (error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 504),
  }: {
    attempts?: number;
    baseDelayMs?: number;
    isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
