import "server-only";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/constants";
import { env, requireEnv } from "@/lib/env";
import { openRouterFetch, withRetry } from "@/lib/openrouter/client";

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

async function embedViaOpenRouter(
  input: string[],
): Promise<number[][]> {
  const response = await openRouterFetch<EmbeddingsResponse>("/embeddings", {
    body: {
      model: EMBEDDING_MODEL,
      input,
      encoding_format: "float",
    },
  });

  if (!response.data?.length) {
    throw new EmbeddingError("OpenRouter returned an empty embedding response");
  }

  return response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

async function embedViaOpenAI(input: string[]): Promise<number[][]> {
  const response = await openRouterFetch<EmbeddingsResponse>("/embeddings", {
    baseUrl: "https://api.openai.com/v1",
    apiKey: requireEnv("OPENAI_API_KEY"),
    body: {
      model: EMBEDDING_MODEL,
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
 * Batching matters: one request with 64 inputs costs the same round trip as
 * one request with a single input, and ingestion of a large SOP otherwise
 * becomes hundreds of sequential calls.
 */
export async function embedBatch(input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];

  const useFallback =
    env().EMBEDDING_FALLBACK_OPENAI === "1" && Boolean(env().OPENAI_API_KEY);

  try {
    const vectors = await withRetry(() => embedViaOpenRouter(input));
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
