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

/**
 * Model ids are provider-specific.
 *
 * Gemini is the default provider because the AI Studio free tier needs no
 * credit card. OpenRouter is the alternative.
 */

/** Gemini embedding model. */
export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

/**
 * Gemini chat model.
 *
 * `gemini-4-hydrogen` is the current flash-tier model on the free tier.
 * The 3.x-flash models return 503 (free-tier capacity) for new accounts,
 * and 2.5-flash is retired for new users.
 */
export const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL ?? "gemini-4-hydrogen";

/** OpenRouter embedding model. */
export const OPENROUTER_EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

/** OpenRouter chat model. */
export const OPENROUTER_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL ?? "anthropic/claude-3.5-sonnet";

/**
 * Vector dimension.
 *
 * Must match the `vector(N)` column in the pgvector schema.
 *
 * This is tied to the active provider: 768 for Gemini's
 * gemini-embedding-001 with output_dimensionality=768 (Matryoshka-trained,
 * so 768 loses almost no retrieval quality against 3072 - MTEB 67.99 vs
 * 68.17 - while halving the column), and 1536 for OpenAI's
 * text-embedding-3-small.
 *
 * Switching providers changes the embedding space, so it requires a schema
 * migration and a full re-embed. See
 * supabase/migrations/20240101000007_embedding_dimension_768.sql.
 */
export const EMBEDDING_DIMENSIONS = Number(
  process.env.EMBEDDING_DIMENSIONS ?? 768,
);

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
   * MEASURED, not guessed. `npx tsx scripts/calibrate-retrieval.ts` against
   * the Gemini embeddings produced:
   *
   *   weakest TRUE top score   0.715
   *   strongest NOISE score    0.637
   *
   * so the usable window is (0.637, 0.715]. 0.65 sits just above the noise
   * ceiling and comfortably below the weakest true match.
   *
   * Note how narrow that window is: dense embedding models share a common
   * direction, so unrelated text still scores around 0.6. The absolute floor
   * is therefore a coarse filter, not a precise one - the relative rule
   * below and the model's own abstention do the real work.
   *
   * Re-run the calibration script once the real corpus is loaded; these
   * numbers came from six chunks of a single SOP.
   */
  ABSOLUTE_FLOOR: 0.65,
  /**
   * Relative band. A chunk is kept when it is within this distance of the
   * best-scoring hit for *this* query. This is what drops weak siblings
   * without touching strong ones.
   *
   * Measured average top-2 margin was 0.084, so 0.10 keeps the top hit and
   * its close siblings.
   */
  RELATIVE_DELTA: 0.1,
} as const;

export const INGEST = {
  /** Max characters per accepted text file. Guards against pathological input. */
  MAX_FILE_CHARS: 2_000_000,
  /** Embeddings are requested in batches of this size. */
  EMBED_BATCH_SIZE: 64,
  /**
   * Max bytes per uploaded file.
   *
   * Vercel caps request bodies at 4.5 MB, so anything larger must be
   * uploaded to Supabase Storage directly rather than through the API
   * route. 4 MB leaves headroom for multipart framing overhead.
   */
  MAX_FILE_BYTES: 4 * 1024 * 1024,
  /** Max pages accepted from a PDF. */
  MAX_PDF_PAGES: 500,
  ACCEPTED_EXTENSIONS: [".md", ".markdown", ".txt", ".pdf"] as const,
  ACCEPTED_MIME_TYPES: [
    "text/markdown",
    "text/plain",
    "text/x-markdown",
    "application/pdf",
  ] as const,
} as const;

export const MAX_QUERY_LENGTH = 2_000;
