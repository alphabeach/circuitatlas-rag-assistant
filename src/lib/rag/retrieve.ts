import "server-only";

import { RETRIEVAL } from "@/lib/constants";
import { toVectorLiteral } from "@/lib/openrouter/embeddings";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Citation, MatchedChunk } from "@/types/database";

/**
 * Vector retrieval.
 *
 * The important logic here is the relevance filter, not the query.
 *
 * `text-embedding-3-small` produces anisotropic vectors: they share a
 * dominant direction, so raw cosine similarity has a high floor and
 * unrelated English text still scores around 0.6-0.8. An absolute threshold
 * in the database therefore cannot separate "weak match among strong
 * candidates" from "nothing relevant exists" - both look like a low number.
 *
 * So we over-fetch, then apply two rules in application code:
 *
 *   1. absolute floor  - nothing below this is even remotely related
 *   2. relative delta  - keep only chunks near the best hit for this query
 *
 * The relative rule is what makes the results stable across queries.
 */

type MatchRow = {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

export type RetrievalResult = {
  citations: Citation[];
  /** All over-fetched candidates with their scores, for debugging. */
  candidates: MatchedChunk[];
  /** True when nothing passed the relevance filter. */
  empty: boolean;
};

/**
 * Applies the relevance rules to over-fetched candidates.
 *
 * Exported separately so the rules can be unit tested without a database.
 */
export function filterCandidates(
  candidates: MatchedChunk[],
  options: {
    absoluteFloor?: number;
    relativeDelta?: number;
    topK?: number;
  } = {},
): MatchedChunk[] {
  const absoluteFloor = options.absoluteFloor ?? RETRIEVAL.ABSOLUTE_FLOOR;
  const relativeDelta = options.relativeDelta ?? RETRIEVAL.RELATIVE_DELTA;
  const topK = options.topK ?? RETRIEVAL.FINAL_TOP_K;

  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];

  if (best.similarity < absoluteFloor) return [];

  const cutoff = best.similarity - relativeDelta;

  return sorted
    .filter((candidate) => candidate.similarity >= absoluteFloor)
    .filter((candidate) => candidate.similarity >= cutoff)
    .slice(0, topK);
}

export async function retrieveChunks(
  queryEmbedding: number[],
  options: {
    documentId?: string;
    absoluteFloor?: number;
    relativeDelta?: number;
    topK?: number;
    overFetch?: number;
  } = {},
): Promise<RetrievalResult> {
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("match_protocol_chunks", {
    query_embedding: toVectorLiteral(queryEmbedding),
    match_threshold: -1,
    match_count: options.overFetch ?? RETRIEVAL.OVER_FETCH,
    filter_document_id: options.documentId ?? null,
  });

  if (error) {
    throw new Error(`Vector search failed: ${error.message}`);
  }

  const candidates: MatchedChunk[] = ((data ?? []) as MatchRow[]).map((row) => ({
    id: row.id,
    document_id: row.document_id,
    content: row.content,
    metadata: row.metadata ?? {},
    similarity: Number(row.similarity),
  }));

  const filtered = filterCandidates(candidates, options);

  const citations = await attachDocumentInfo(filtered);

  return { citations, candidates, empty: citations.length === 0 };
}

/**
 * Resolves document titles for the citation cards.
 *
 * One query for the whole batch rather than one per chunk.
 */
async function attachDocumentInfo(chunks: MatchedChunk[]): Promise<Citation[]> {
  if (chunks.length === 0) return [];

  const documentIds = [...new Set(chunks.map((c) => c.document_id))];
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("protocol_documents")
    .select("id, title, filename")
    .in("id", documentIds);

  const documents = new Map(
    ((data ?? []) as Array<{ id: string; title: string; filename: string }>).map(
      (doc) => [doc.id, doc],
    ),
  );

  return chunks.map((chunk, index) => {
    const document = documents.get(chunk.document_id);
    const heading =
      typeof chunk.metadata.heading === "string" ? chunk.metadata.heading : null;

    return {
      id: chunk.id,
      documentId: chunk.document_id,
      documentTitle: document?.title ?? "Unknown document",
      filename: document?.filename ?? "unknown",
      heading,
      content: chunk.content,
      similarity: chunk.similarity,
      ordinal: index + 1,
    };
  });
}
