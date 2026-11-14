import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET    /api/documents        - list ingested documents
 * GET    /api/documents?id=... - one document with its chunks, in reading order
 * DELETE /api/documents?id=... - delete a document and its chunks
 */

type ChunkRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  char_count: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const supabase = getAdminClient();

  // One document with its text, for the source viewer.
  if (id) {
    const { data: document, error: documentError } = await supabase
      .from("protocol_documents")
      .select(
        "id, title, filename, mime_type, tags, chunk_count, char_count, created_at, file_url",
      )
      .eq("id", id)
      .single();

    if (documentError || !document) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }

    const { data: chunks, error: chunkError } = await supabase
      .from("protocol_chunks")
      .select("id, content, metadata, char_count")
      .eq("document_id", id);

    if (chunkError) {
      return Response.json(
        { error: `Failed to load chunks: ${chunkError.message}` },
        { status: 500 },
      );
    }

    // The ordinal lives in the metadata, so the sort happens here.
    const ordered = ((chunks ?? []) as ChunkRow[]).sort(
      (a, b) => ordinalOf(a) - ordinalOf(b),
    );

    return Response.json({ document, chunks: ordered });
  }

  const { data, error } = await supabase
    .from("protocol_documents")
    .select(
      "id, title, filename, mime_type, tags, chunk_count, char_count, created_at, file_url",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return Response.json(
      { error: `Failed to list documents: ${error.message}` },
      { status: 500 },
    );
  }

  return Response.json({ documents: data ?? [] });
}

function ordinalOf(chunk: ChunkRow): number {
  const ordinal = chunk.metadata?.ordinal;
  return typeof ordinal === "number" ? ordinal : 0;
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Document id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Chunks cascade via the foreign key, but deleting explicitly keeps the
  // behaviour correct even if the constraint is ever relaxed.
  const { error: chunkError } = await supabase
    .from("protocol_chunks")
    .delete()
    .eq("document_id", id);

  if (chunkError) {
    return Response.json(
      { error: `Failed to delete chunks: ${chunkError.message}` },
      { status: 500 },
    );
  }

  const { error: documentError } = await supabase
    .from("protocol_documents")
    .delete()
    .eq("id", id);

  if (documentError) {
    return Response.json(
      { error: `Failed to delete document: ${documentError.message}` },
      { status: 500 },
    );
  }

  return Response.json({ deleted: id });
}
