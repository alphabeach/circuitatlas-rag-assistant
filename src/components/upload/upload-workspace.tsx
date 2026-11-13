"use client";

import { Loader2, UploadCloud } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { DocumentTable, type DocumentRow } from "@/components/upload/document-table";
import { Dropzone, type StagedFile } from "@/components/upload/dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export function UploadWorkspace() {
  const [files, setFiles] = React.useState<StagedFile[]>([]);
  const [tags, setTags] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = React.useState(true);

  const fetchDocuments = React.useCallback(async () => {
    const response = await fetch("/api/documents");
    if (!response.ok) throw new Error("Failed to load documents");
    const body = await response.json();
    return (body.documents ?? []) as DocumentRow[];
  }, []);

  const loadDocuments = React.useCallback(async () => {
    try {
      setDocuments(await fetchDocuments());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load documents",
      );
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [fetchDocuments]);

  React.useEffect(() => {
    // Fetch directly in the effect. State updates happen after the await,
    // never synchronously in the effect body, so there is no cascading
    // render.
    let cancelled = false;

    void (async () => {
      try {
        const documents = await fetchDocuments();
        if (!cancelled) setDocuments(documents);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Failed to load documents",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingDocuments(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchDocuments]);

  const handleUpload = async () => {
    const valid = files.filter((file) => !file.error);
    if (valid.length === 0) {
      toast.error("Choose at least one file to upload");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      for (const staged of valid) {
        formData.append("files", staged.file);
      }
      if (tags.trim()) {
        formData.append("tags", tags.trim());
      }

      const response = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });

      const body = await response.json().catch(() => ({}));

      if (body.ingested?.length) {
        const chunkTotal = body.ingested.reduce(
          (sum: number, item: { chunkCount: number }) => sum + item.chunkCount,
          0,
        );
        toast.success(
          `Indexed ${body.ingested.length} document${body.ingested.length === 1 ? "" : "s"} (${chunkTotal} chunks)`,
        );
      }

      if (body.failed?.length) {
        for (const failure of body.failed) {
          toast.error(`${failure.filename}: ${failure.error}`);
        }
      }

      if (!body.ingested?.length && !body.failed?.length) {
        toast.error("Upload failed");
      }

      setFiles([]);
      setIsLoadingDocuments(true);
      await loadDocuments();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 lg:py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Protocol corpus
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Upload laboratory SOPs to make them searchable. Files are chunked on
          their heading structure, embedded, and indexed in pgvector. Answers
          are grounded only in what is indexed here.
        </p>
      </div>

      <div className="space-y-6">
        <Dropzone
          files={files}
          onFilesChange={setFiles}
          disabled={isUploading}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="tags" className="text-xs font-medium">
              Tags <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="safety, cell-culture, qc"
              disabled={isUploading}
            />
            <p className="text-[11px] text-muted-foreground">
              Comma-separated. Applied to every file in this upload.
            </p>
          </div>

          <Button
            onClick={handleUpload}
            disabled={isUploading || files.length === 0}
            className="gap-1.5 sm:w-40"
          >
            {isUploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UploadCloud className="size-4" />
            )}
            {isUploading ? "Indexing" : "Upload and index"}
          </Button>
        </div>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Indexed documents
          </h2>
          {isLoadingDocuments ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading corpus...
            </div>
          ) : (
            <DocumentTable documents={documents} onChanged={loadDocuments} />
          )}
        </section>
      </div>
    </div>
  );
}
