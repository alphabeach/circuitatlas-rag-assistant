import "server-only";

import {
  EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
} from "@/lib/constants";
import { env, requireEnv } from "@/lib/env";
import {
  openRouterFetch,
  OpenRouterError,
  withRetry,
} from "@/lib/openrouter/client";

/**
 * Query and document vectorization.
 *
 * OpenRouter exposes an OpenAI-compatible `/embeddings` endpoint, so the
 * same model id works for both ingestion and querying. If OpenRouter is
 * unavailable and an OpenAI key is present, we fall back to OpenAI's
 * `/v1/embeddings` - same model, same dimension, so vectors stay
 * comparable across both paths.
 */

type EmbeddingsResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

export class EmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Requests per minute allowed on the free-model tier.
 *
 * Free models are shared across every OpenRouter account, so the limit is
 * low and shared. Exceeding it returns 429 with a reset timestamp.
 */
const FREE_MODEL_REQUESTS_PER_MINUTE = 18;

/** Timestamps of recent embedding requests, used to pace ourselves. */
const recentRequests: number[] = [];

/**
 * Waits until we are under the per-minute request budget.
 *
 * Without this, ingesting a large SOP trips the rate limit repeatedly and
 * the retry loop turns into a stall.
 */
async function paceRequest(): Promise<void> {
  const now = Date.now();
  const cutoff = now - 60_000;

  while (recentRequests.length > 0 && recentRequests[0] < cutoff) {
    recentRequests.shift();
  }

  if (recentRequests.length >= FREE_MODEL_REQUESTS_PER_MINUTE) {
    const waitMs = recentRequests[0] + 60_000 - now + 250;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return paceRequest();
  }

  recentRequests.push(now);
}

async function requestEmbeddings(
  input: string[],
): Promise<EmbeddingsResponse> {
  await paceRequest();

  return openRouterFetch<EmbeddingsResponse>("/embeddings", {
    body: {
      model: OPENROUTER_EMBEDDING_MODEL,
      input,
      encoding_format: "float",
    },
  });
}

/**
 * Some providers in the free pool accept only a single string per request
 * and reject arrays with an `invalid_union` validation error. Detect that
 * and fall back to one request per input.
 */
function isBatchUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false;
  if (error.status !== 400) return false;
  const body = error.body ?? "";
  return (
    body.includes("invalid_union") ||
    body.includes("expected string") ||
    body.includes("received array")
  );
}

async function embedViaOpenRouter(
  input: string[],
): Promise<number[][]> {
  const response = await requestEmbeddings(input);

  if (!response.data?.length) {
    throw new EmbeddingError("OpenRouter returned an empty embedding response");
  }

  const vectors = response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);

  if (vectors.length !== input.length) {
    throw new EmbeddingError(
      `Expected ${input.length} embedding(s) but received ${vectors.length}. ` +
        `The provider may not support batched input for this model.`,
    );
  }

  return vectors;
}

/**
 * Embeds a batch, falling back to single requests if the provider
 * rejects array input.
 */
async function embedBatchAdaptive(input: string[]): Promise<number[][]> {
  try {
    return await embedViaOpenRouter(input);
  } catch (error) {
    if (!isBatchUnsupported(error) || input.length === 1) throw error;

    // Retry the whole batch one input at a time.
    const vectors: number[][] = [];
    for (const text of input) {
      vectors.push(...(await embedViaOpenRouter([text])));
    }
    return vectors;
  }
}

async function embedViaOpenAI(input: string[]): Promise<number[][]> {
  const response = await openRouterFetch<EmbeddingsResponse>("/embeddings", {
    baseUrl: "https://api.openai.com/v1",
    apiKey: requireEnv("OPENAI_API_KEY"),
    body: {
      model: OPENROUTER_EMBEDDING_MODEL,
      input,
      encoding_format: "float",
    },
  });

  if (!response.data?.length) {
    throw new EmbeddingError("OpenAI returned an empty embedding response");
  }

  return response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

function validateDimensions(vectors: number[][]) {
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(
        `Expected ${EMBEDDING_DIMENSIONS}-dimensional vectors but received ${vector.length}. ` +
          `The embedding model and the pgvector column dimension must match.`,
      );
    }
  }
}

/**
 * Embeds a batch of strings.
 *
 * Batching matters for cost and latency, but the free-model tier caps both
 * the batch size and the request rate, so the request layer adapts rather
 * than assuming a provider will accept an array.
 */
export async function embedBatch(input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];

  const useFallback =
    env().EMBEDDING_FALLBACK_OPENAI === "1" && Boolean(env().OPENAI_API_KEY);

  try {
    const vectors = await withRetry(() => embedBatchAdaptive(input));
    validateDimensions(vectors);
    return vectors;
  } catch (error) {
    if (!useFallback) {
      throw new EmbeddingError(
        `Failed to embed ${input.length} text(s) via OpenRouter: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
    }

    const vectors = await withRetry(() => embedViaOpenAI(input));
    validateDimensions(vectors);
    return vectors;
  }
}

/** Embeds a single string (used for query vectorization). */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  if (!vector) throw new EmbeddingError("Query embedding produced no vector");
  return vector;
}

/**
 * Serializes a vector into the pgvector text representation.
 *
 * pgvector accepts a JSON-ish array literal. The array form is what
 * PostgREST expects when passing a parameter to an RPC.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
