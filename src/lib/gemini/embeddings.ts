import "server-only";

import {
  EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL,
} from "@/lib/constants";
import { requireEnv } from "@/lib/env";
import { geminiFetch, withRetry } from "@/lib/gemini/client";

/**
 * Gemini embeddings.
 *
 * `gemini-embedding-001` supports task types, and for a RAG system those
 * matter: documents are embedded with RETRIEVAL_DOCUMENT and queries with
 * RETRIEVAL_QUERY. The model is trained separately for those roles, so
 * using the right one measurably improves retrieval.
 *
 * Output dimension is configurable (MRL). 768 is the recommended
 * size - MTEB scores barely move between 768 and 3072, and a smaller
 * vector means a smaller pgvector column and a faster index.
 */

export type EmbeddingTask = "document" | "query";

type GeminiEmbeddingResponse = {
  embeddings?: Array<{ values?: number[] }>;
};

const TASK_TYPES: Record<EmbeddingTask, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

/**
 * Maximum inputs per batchEmbedContents call.
 *
 * The `embedContent` endpoint aggregates multiple parts into a single
 * vector, so batching requires `batchEmbedContents`, which returns one
 * embedding per request. The API accepts a bounded number of requests per
 * call, so large inputs are split.
 */
const MAX_BATCH_SIZE = 64;

export class GeminiEmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeminiEmbeddingError";
  }
}

async function embedViaGemini(
  input: string[],
  task: EmbeddingTask,
): Promise<number[][]> {
  const apiKey = requireEnv("GEMINI_API_KEY");

  const response = await geminiFetch<GeminiEmbeddingResponse>(
    `/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
    {
      apiKey,
      body: {
        requests: input.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          taskType: TASK_TYPES[task],
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      },
    },
  );

  const vectors = (response.embeddings ?? [])
    .map((embedding) => embedding.values)
    .filter((values): values is number[] => Array.isArray(values));

  if (vectors.length !== input.length) {
    throw new GeminiEmbeddingError(
      `Expected ${input.length} embedding(s) but received ${vectors.length}.`,
    );
  }

  return vectors;
}

export async function embedBatchGemini(
  input: string[],
  task: EmbeddingTask = "document",
): Promise<number[][]> {
  if (input.length === 0) return [];

  try {
    const vectors: number[][] = [];

    for (let i = 0; i < input.length; i += MAX_BATCH_SIZE) {
      const batch = input.slice(i, i + MAX_BATCH_SIZE);
      vectors.push(...(await withRetry(() => embedViaGemini(batch, task))));
    }

    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new GeminiEmbeddingError(
          `Expected ${EMBEDDING_DIMENSIONS}-dimensional vectors but received ${vector.length}. ` +
            `The embedding model and the pgvector column dimension must match.`,
        );
      }
    }

    return vectors;
  } catch (error) {
    throw new GeminiEmbeddingError(
      `Failed to embed ${input.length} text(s) via Gemini: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }
}
