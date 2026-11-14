/**
 * A rectangle on a PDF page, in PDF points with the origin at the
 * bottom-left of the page (the coordinate system PDF.js uses).
 *
 * Stored with each PDF chunk so the UI can draw the retrieved passage on
 * the page itself.
 */
export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProtocolDocument = {
  id: string;
  title: string;
  filename: string;
  storage_path: string | null;
  /** Address the original upload is served from, for the PDF viewer. */
  file_url: string | null;
  mime_type: string | null;
  tags: string[];
  chunk_count: number;
  char_count: number;
  created_at: string;
  updated_at: string;
};

export type ProtocolChunk = {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  char_count: number;
  created_at: string;
};

export type MatchedChunk = {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

/** A retrieved chunk plus the document it came from, as sent to the client. */
export type Citation = {
  id: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  heading: string | null;
  content: string;
  similarity: number;
  ordinal: number;
  /** Source chunk metadata. PDF chunks include a `page` number. */
  metadata: Record<string, unknown>;
};

export type IngestResult = {
  documentId: string;
  title: string;
  filename: string;
  chunkCount: number;
  charCount: number;
};

export type DocumentSummary = {
  id: string;
  title: string;
  filename: string;
  tags: string[];
  chunkCount: number;
  charCount: number;
  createdAt: string;
};
