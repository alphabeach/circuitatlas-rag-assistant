"use client";

import { FileText, Upload, X } from "lucide-react";
import * as React from "react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import { INGEST } from "@/lib/constants";
import { cn, formatBytes } from "@/lib/utils";

export type StagedFile = {
  id: string;
  file: File;
  error?: string;
};

/**
 * File picker for SOP uploads.
 *
 * Markdown and plain text only. The restriction is surfaced in the UI
 * rather than enforced silently at the API boundary, so a rejected file
 * explains itself.
 */
export function Dropzone({
  files,
  onFilesChange,
  disabled,
}: {
  files: StagedFile[];
  onFilesChange: (files: StagedFile[]) => void;
  disabled?: boolean;
}) {
  const addFiles = React.useCallback(
    (accepted: File[]) => {
      const staged = accepted.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
      }));
      onFilesChange([...files, ...staged]);
    },
    [files, onFilesChange],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDropAccepted: addFiles,
      onDropRejected: (rejections) => {
        const messages = rejections.map(
          (rejection) =>
            `${rejection.file.name}: ${rejection.errors[0]?.message ?? "rejected"}`,
        );
        onFilesChange([
          ...files,
          ...messages.map((message) => ({
            id: `err-${message}-${Math.random().toString(36).slice(2)}`,
            file: new File([""], "rejected", { type: "text/plain" }),
            error: message,
          })),
        ]);
      },
      accept: {
        "text/markdown": [".md", ".markdown"],
        "text/plain": [".txt"],
        "application/pdf": [".pdf"],
      },
      maxSize: INGEST.MAX_FILE_BYTES,
      disabled,
    });

  const removeFile = (id: string) => {
    onFilesChange(files.filter((file) => file.id !== id));
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center transition-colors",
          "hover:border-primary/40 hover:bg-card",
          isDragActive && "border-primary bg-primary/5",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <input {...getInputProps()} />
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Upload className="size-5" />
        </span>
        <div>
          <p className="text-sm font-medium">
            {isDragActive
              ? "Drop the files here"
              : "Drag SOPs here, or click to browse"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF (.pdf), Markdown (.md), and plain text (.txt). Scanned PDFs
            without a text layer are not supported.
          </p>
        </div>
      </div>

      {fileRejections.length > 0 && (
        <p className="text-xs text-destructive">
          {fileRejections.length} file
          {fileRejections.length === 1 ? " was" : "s were"} rejected. Only
          PDF, Markdown, and text files under{" "}
          {formatBytes(INGEST.MAX_FILE_BYTES)} are accepted.
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((staged) => (
            <li
              key={staged.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <FileText
                className={cn(
                  "size-4 shrink-0",
                  staged.error ? "text-destructive" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                {staged.error ? (
                  <p className="truncate text-xs text-destructive">
                    {staged.error}
                  </p>
                ) : (
                  <>
                    <p className="truncate text-sm">{staged.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(staged.file.size)}
                    </p>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => removeFile(staged.id)}
                disabled={disabled}
                aria-label={`Remove ${staged.file.name}`}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
