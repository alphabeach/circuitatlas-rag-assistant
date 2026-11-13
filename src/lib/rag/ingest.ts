import "server-only";

import { INGEST } from "@/lib/constants";
import { embedBatch } from "@/lib/openrouter/embeddings";
import { parseDocument } from "@/lib/parsers";
import { getAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import type { IngestResult } from "@/types/database";

/**
 * Ingestion pipeline.
 *
 * parse -> chunk -> batch-embed -> insert
 *
 * The original file is also stored in Supabase Storage so a document can be
 * re-ingested or audited later, and so the upload path is not bound by the
 * 4.5 MB Vercel request body limit.
 */

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export async function ingestDocument(
  input: string | Uint8Array,
  filename: string,
  options: { mimeType?: string; title?: string; tags?: string[] } = {},
): Promise<IngestResult> {
  const parsed = await parseDocument(input, filename, options.mimeType);
  const title = options.title?.trim() || parsed.title;
  const tags = options.tags?.length ? options.tags : parsed.tags;

  const supabase = getAdminClient();

  // 1. Register the document.
  const { data: document, error: insertError } = await supabase
    .from("protocol_documents")
    .insert({
      title,
      filename,
      mime_type: options.mimeType ?? null,
      tags,
      chunk_count: parsed.chunks.length,
      char_count: parsed.content.length,
    })
    .select("id")
    .single();

  if (insertError || !document) {
    throw new IngestError(
      `Failed to register document: ${insertError?.message ?? "unknown error"}`,
    );
  }

  // 2. Store the original file. A storage failure is not fatal - the
  //    chunks are what make the document searchable.
  let storagePath: string | null = null;
  try {
    storagePath = await storeOriginalFile(document.id, input, filename);
    await supabase
      .from("protocol_documents")
      .update({ storage_path: storagePath })
      .eq("id", document.id);
  } catch (error) {
    console.warn(
      `[ingest] Could not store original file for ${filename}:`,
      error instanceof Error ? error.message : error,
    );
  }

  // From here on, any failure must roll back the document row. Otherwise a
  // failed embed leaves an entry in protocol_documents with a chunk_count
  // but no actual chunks - a document that appears ingested but can never
  // be retrieved.
  try {
    // 3. Embed the chunks in batches.
    const embeddings: number[][] = [];
    for (
      let i = 0;
      i < parsed.chunks.length;
      i += INGEST.EMBED_BATCH_SIZE
    ) {
      const batch = parsed.chunks.slice(i, i + INGEST.EMBED_BATCH_SIZE);
      const vectors = await embedBatch(batch.map((chunk) => chunk.content));
      embeddings.push(...vectors);
    }

    // 4. Insert the chunks.
    const rows = parsed.chunks.map((chunk, index) => ({
      document_id: document.id,
      content: chunk.content,
      metadata: {
        ...chunk.metadata,
        filename,
        title,
        tags,
        ordinal: chunk.metadata.ordinal,
      },
      embedding: embeddings[index],
      char_count: chunk.content.length,
    }));

    const { error: chunkError } = await supabase
      .from("protocol_chunks")
      .insert(rows);

    if (chunkError) {
      throw new IngestError(
        `Failed to store ${rows.length} chunk(s): ${chunkError.message}`,
      );
    }
  } catch (error) {
    await supabase.from("protocol_documents").delete().eq("id", document.id);
    throw error;
  }

  return {
    documentId: document.id,
    title,
    filename,
    chunkCount: parsed.chunks.length,
    charCount: parsed.content.length,
  };
}

async function storeOriginalFile(
  documentId: string,
  input: string | Uint8Array,
  filename: string,
): Promise<string> {
  const { env } = await import("@/lib/env");
  const bucket = env().SUPABASE_STORAGE_BUCKET;
  const path = `${documentId}/${slugify(filename) || "document"}`;

  const body =
    typeof input === "string"
      ? new Blob([input], { type: "text/markdown" })
      : new Blob([input as BlobPart], { type: "application/pdf" });

  const supabase = getAdminClient();
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    upsert: true,
    contentType: body.type,
  });

  if (error) throw new Error(error.message);

  return path;
}
