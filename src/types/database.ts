export type ProtocolDocument = {
  id: string;
  title: string;
  filename: string;
  storage_path: string | null;
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
