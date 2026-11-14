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

/**
 * True when Gemini refused because of the quota rather than because of a
 * bad request.
 */
export function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;

  const text = body.toLowerCase();
  return (
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("resource_exhausted")
  );
}

/** The message a technician sees instead of a raw quota payload. */
export const RATE_LIMIT_MESSAGE =
  "Rate limit reached - please wait and try again.";

/**
 * Turns a failed Gemini response into a message worth reading.
 *
 * Gemini explains its refusals in a JSON payload that runs to several
 * lines - model retirement notices, quota windows, service states. None of
 * that belongs in an error card: the technician needs one sentence, and
 * the payload belongs in the server log.
 */
export function readableError(status: number, body: string): string {
  console.error(`Gemini ${status}: ${body.slice(0, 500)}`);

  if (isRateLimited(status, body)) return RATE_LIMIT_MESSAGE;
  if (status === 401 || status === 403) {
    return "The Gemini API key was rejected - check GEMINI_API_KEY.";
  }
  if (status === 404) {
    return "That Gemini model is not available to this account - check the model id.";
  }
  if (status === 400) {
    return "Gemini rejected the request - the question or context may be too long.";
  }
  if (status >= 500) {
    return "Gemini is busy right now - please try again.";
  }
  return `The Gemini request failed (HTTP ${status}).`;
}

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
      readableError(response.status, text),
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
