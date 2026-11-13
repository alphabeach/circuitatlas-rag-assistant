import { INGEST } from "@/lib/constants";
import { ingestDocument, IngestError } from "@/lib/rag/ingest";
import {
  UnsupportedFormatError,
  PdfParseError,
  acceptedExtensions,
} from "@/lib/parsers";

/**
 * POST /api/ingest
 *
 * Accepts a multipart upload of one or more Markdown/text SOPs, then parses,
 * chunks, embeds, and stores them.
 *
 * GET returns the list of ingested documents.
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with a 'files' field" },
      { status: 400 },
    );
  }

  const files = formData.getAll("files").filter(isFile);
  const tags = parseTags(formData.get("tags"));

  if (files.length === 0) {
    return Response.json(
      {
        error: `No files provided. Accepted formats: ${acceptedExtensions().join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const results: Array<{ filename: string; documentId: string; chunkCount: number }> = [];
  const failures: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    try {
      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      // PDFs are read as bytes; text formats are read as UTF-8 text.
      const raw = isPdf
        ? new Uint8Array(await file.arrayBuffer())
        : await file.text();

      const result = await ingestDocument(raw, file.name, {
        mimeType: file.type || undefined,
        tags,
      });
      results.push({
        filename: result.filename,
        documentId: result.documentId,
        chunkCount: result.chunkCount,
      });
    } catch (error) {
      failures.push({
        filename: file.name,
        error:
          error instanceof UnsupportedFormatError ||
          error instanceof IngestError ||
          error instanceof PdfParseError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error",
      });
    }
  }

  const status = results.length === 0 ? 400 : 200;

  return Response.json(
    {
      ingested: results,
      failed: failures,
      acceptedFormats: INGEST.ACCEPTED_EXTENSIONS,
    },
    { status },
  );
}

export async function GET() {
  const { getAdminClient } = await import("@/lib/supabase/admin");
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

function isFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

function parseTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
