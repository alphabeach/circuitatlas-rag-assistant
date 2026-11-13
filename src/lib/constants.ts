/**
 * Central tuning surface for the retrieval pipeline.
 *
 * The similarity thresholds are deliberately low. text-embedding-3-small
 * produces anisotropic vectors: unrelated text still scores roughly 0.6-0.8
 * on a raw cosine scale, so a "safe looking" threshold like 0.5 either
 * returns nothing or returns everything. Relevance is therefore judged
 * *relatively* against the best hit for the query, with an absolute floor
 * only to catch the "nothing relevant exists at all" case.
 */

export const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

/** Must match the `vector(N)` dimension used in the pgvector column. */
export const EMBEDDING_DIMENSIONS = 1536;

export const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL ?? "anthropic/claude-sonnet-4.5";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Chunking. ~400 tokens with a 60 token overlap keeps SOP steps intact. */
export const CHUNK_SIZE_TOKENS = 400;
export const CHUNK_OVERLAP_TOKENS = 60;

/**
 * Rough characters-per-token ratio for English technical prose. Used instead
 * of a tokenizer dependency so chunk sizes stay predictable and the bundle
 * stays small.
 */
export const CHARS_PER_TOKEN = 3.6;

export const CHUNK_SIZE_CHARS = Math.round(
  CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN,
);
export const CHUNK_OVERLAP_CHARS = Math.round(
  CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN,
);

export const RETRIEVAL = {
  /** Rows pulled from pgvector before any filtering. */
  OVER_FETCH: 30,
  /** Chunks actually sent to the LLM. */
  FINAL_TOP_K: 8,
  /**
   * Absolute floor on the best hit for the query.
   *
   * This is the backstop for "nothing in the corpus is relevant". It has
   * to sit above the score an unrelated pair typically receives and below
   * the score a genuinely related pair typically receives. For
   * text-embedding-3-small those land around 0.15-0.35 (unrelated) and
   * 0.50-0.85 (related), so 0.35 is the midpoint.
   *
   * Set this too low and every query returns something, which defeats the
   * abstention path. Set it too high and real matches get dropped.
   */
  ABSOLUTE_FLOOR: 0.35,
  /**
   * Relative band. A chunk is kept when it is within this distance of the
   * best-scoring hit for *this* query. This is what drops weak siblings
   * without touching strong ones.
   */
  RELATIVE_DELTA: 0.12,
} as const;

export const INGEST = {
  /** Max characters per accepted file. Guards against pathological input. */
  MAX_FILE_CHARS: 2_000_000,
  /** Embeddings are requested in batches of this size. */
  EMBED_BATCH_SIZE: 64,
  ACCEPTED_EXTENSIONS: [".md", ".markdown", ".txt"] as const,
  ACCEPTED_MIME_TYPES: [
    "text/markdown",
    "text/plain",
    "text/x-markdown",
  ] as const,
} as const;

export const MAX_QUERY_LENGTH = 2_000;
