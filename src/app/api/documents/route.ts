import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET    /api/documents        - list ingested documents
 * DELETE /api/documents?id=... - delete a document and its chunks
 */

export async function GET() {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("protocol_documents")
    .select(
      "id, title, filename, mime_type, tags, chunk_count, char_count, created_at",
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
