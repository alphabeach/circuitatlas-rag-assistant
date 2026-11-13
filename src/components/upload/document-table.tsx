"use client";

import { Database, FileText, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";

export type DocumentRow = {
  id: string;
  title: string;
  filename: string;
  mime_type: string | null;
  tags: string[];
  chunk_count: number;
  char_count: number;
  created_at: string;
};

/**
 * Lists ingested documents.
 *
 * Also surfaces corpus statistics, because the single most common cause of
 * a bad answer is an empty or tiny corpus - seeing "3 documents, 47 chunks"
 * makes that immediately obvious.
 */
export function DocumentTable({
  documents,
  onChanged,
}: {
  documents: DocumentRow[];
  onChanged?: () => void;
}) {
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const totalChunks = documents.reduce(
    (sum, document) => sum + document.chunk_count,
    0,
  );

  const handleDelete = async (id: string, title: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response
          .json()
          .then((data: { error?: string }) => data.error)
          .catch(() => null);
        throw new Error(body ?? "Failed to delete document");
      }

      toast.success(`Deleted "${title}"`);
      onChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete document",
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
        <Database className="size-6 text-muted-foreground/50" />
        <p className="text-sm font-medium">No protocols ingested yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Upload Markdown or text SOPs above. They are chunked and embedded
          automatically, and become searchable immediately.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="size-3.5" />
        {documents.length} document{documents.length === 1 ? "" : "s"} &middot;{" "}
        {totalChunks} chunk{totalChunks === 1 ? "" : "s"} indexed
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead className="w-24 text-right">Chunks</TableHead>
              <TableHead className="w-32 text-right">Ingested</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => (
              <TableRow key={document.id}>
                <TableCell>
                  <div className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {document.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {document.filename}
                      </p>
                      {document.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {document.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {document.chunk_count}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatRelativeTime(document.created_at)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(document.id, document.title)}
                    disabled={deletingId === document.id}
                    aria-label={`Delete ${document.title}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
