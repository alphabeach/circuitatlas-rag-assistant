import "server-only";

import { OPENROUTER_BASE_URL } from "@/lib/constants";
import { requireEnv } from "@/lib/env";

/**
 * Shared OpenRouter transport.
 *
 * Uses raw fetch rather than a vendor SDK so the request shape stays
 * explicit and the same code path can target either OpenRouter or OpenAI
 * for the embedding fallback.
 */

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export type FetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  /** Overrides the default Authorization scheme (OpenAI also uses Bearer). */
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};

export async function openRouterFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const apiKey = options.apiKey ?? requireEnv("OPENROUTER_API_KEY");
  const baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;

  // Catch placeholder keys early. A placeholder produces a confusing 401
  // from the provider that looks like a credential problem rather than a
  // setup problem.
  if (!options.apiKey && !apiKey.startsWith("sk-or-")) {
    throw new OpenRouterError(
      `OPENROUTER_API_KEY does not look like a valid OpenRouter key (expected it to start with "sk-or-"). ` +
        `Set a real key in .env.local or export it in your shell before starting the dev server.`,
      401,
    );
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://circuitatlas.local",
      "X-Title": "CircuitAtlas Protocol Assistant",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new OpenRouterError(
        `OpenRouter rejected the API key (${response.status}) for ${path}. ` +
          `Check that OPENROUTER_API_KEY is set to a valid key and that it has credit.`,
        response.status,
        text,
      );
    }
    throw new OpenRouterError(
      `OpenRouter request failed (${response.status}) for ${path}: ${text.slice(0, 500)}`,
      response.status,
      text,
    );
  }

  return (await response.json()) as T;
}

/**
 * Retries transient failures with exponential backoff.
 *
 * OpenRouter surfaces provider overload as 529 and rate limits as 429.
 * Both are worth retrying; 400-class errors are not.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 500,
    isRetryable = (error: unknown) =>
      error instanceof OpenRouterError &&
      (error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 529),
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
