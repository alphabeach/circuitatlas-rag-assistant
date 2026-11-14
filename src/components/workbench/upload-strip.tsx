"use client";

import { Upload, X } from "lucide-react";
import * as React from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { INGEST } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type DocumentRow = {
  id: string;
  title: string;
  filename: string;
  mime_type: string | null;
  file_url: string | null;
  tags: string[];
  chunk_count: number;
  char_count: number;
  created_at: string;
};

/**
 * The ingestion strip.
 *
 * One line: a drop target that indexes files the moment they land, and the
 * indexed protocols as pills. A protocol is removed with the cross on its
 * pill, which deletes it and its chunks.
 */
export function UploadStrip({
  documents,
  activeId,
  onChanged,
  onSelect,
}: {
  documents: DocumentRow[];
  activeId: string | null;
  onChanged: () => Promise<DocumentRow[]>;
  onSelect: (documentId: string) => void;
}) {
  const [uploading, setUploading] = React.useState(false);

  const upload = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setUploading(true);
      const formData = new FormData();
      for (const file of files) formData.append("files", file);

      try {
        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });
        const body = await response.json().catch(() => ({}));

        const ingested = (body.ingested ?? []) as Array<{
          filename: string;
          documentId: string;
          chunkCount: number;
        }>;

        for (const item of ingested) {
          toast.success(
            `Indexed ${item.filename} - ${item.chunkCount} sections`,
          );
        }
        for (const failure of body.failed ?? []) {
          toast.error(`${failure.filename}: ${failure.error}`);
        }
        if (ingested.length === 0 && !body.failed?.length) {
          toast.error("Upload failed");
        }

        const list = (await onChanged()) as DocumentRow[];

        // The file is what the viewer opens. If it did not reach storage,
        // say so instead of leaving an empty pane.
        for (const item of ingested) {
          const stored = list.find((doc) => doc.id === item.documentId);
          if (stored && !stored.file_url) {
            toast.warning(
              `${item.filename} was indexed, but its file could not be stored - the viewer cannot open it.`,
            );
          }
        }

        if (ingested.length > 0) onSelect(ingested[0].documentId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Upload failed",
        );
      } finally {
        setUploading(false);
      }
    },
    [onChanged, onSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "text/markdown": [".md", ".markdown"],
      "text/plain": [".txt"],
      "application/pdf": [".pdf"],
    },
    maxSize: INGEST.MAX_FILE_BYTES,
    disabled: uploading,
    onDropAccepted: upload,
    onDropRejected: (rejections) => {
      toast.error(
        `${rejections.length} file${rejections.length === 1 ? "" : "s"} rejected - PDF, Markdown or text only`,
      );
    },
  });

  const remove = React.useCallback(
    async (document: DocumentRow) => {
      const response = await fetch(
        `/api/documents?id=${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        toast.error("Could not remove the protocol");
        return;
      }

      toast.success(`Removed ${document.title}`);
      await onChanged();
    },
    [onChanged],
  );

  return (
    <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
      <div
        {...getRootProps()}
        className={cn(
          "flex min-h-[96px] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border p-4 text-center transition-colors",
          "hover:border-primary/60 hover:bg-accent/40",
          isDragActive && "border-primary bg-primary/10",
          uploading && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <Upload className="size-5 text-primary" />
        <p className="text-sm font-medium">
          {isDragActive
            ? "Drop to index"
            : "Drop SOPs here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          PDF (.pdf), Markdown (.md) and plain text (.txt). Files are indexed
          as soon as they land.
        </p>
      </div>

      {uploading && (
        <div
          role="status"
          aria-label="Indexing"
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}

      {documents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {documents.map((document) => (
            <span
              key={document.id}
              className={cn(
                "inline-flex max-w-56 items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-[11px]",
                document.id === activeId
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(document.id)}
                className="truncate transition-colors hover:text-foreground"
                title={document.filename}
              >
                {document.title}
              </button>
              <button
                type="button"
                onClick={() => void remove(document)}
                aria-label={`Remove ${document.title}`}
                className="rounded-full p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
