import { env } from "@/lib/env";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/documents/file?id=<document id>
 *
 * Streams the original upload back to the browser.
 *
 * The bucket is private, so the bytes go through the server. The address
 * is stable, which is why it is stored on the document instead of a
 * signed URL that would expire.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Document id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: document, error } = await supabase
    .from("protocol_documents")
    .select("id, filename, mime_type, storage_path")
    .eq("id", id)
    .single();

  if (error || !document) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  if (!document.storage_path) {
    return Response.json(
      { error: "The original file for this document was not stored" },
      { status: 404 },
    );
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(env().SUPABASE_STORAGE_BUCKET)
    .download(document.storage_path);

  if (downloadError || !file) {
    return Response.json(
      {
        error: `Could not read the stored file: ${
          downloadError?.message ?? "unknown error"
        }`,
      },
      { status: 500 },
    );
  }

  return new Response(await file.arrayBuffer(), {
    headers: {
      "Content-Type": document.mime_type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${document.filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
