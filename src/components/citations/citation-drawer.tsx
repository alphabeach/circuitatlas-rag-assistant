"use client";

import { FileSearch } from "lucide-react";

import { SourceCard } from "@/components/citations/source-card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { Citation } from "@/types/database";

/**
 * Citation drawer.
 *
 * Shows every retrieved chunk alongside its similarity score so a technician
 * can verify a claim against the source protocol text. This is the
 * scientific-verifiability requirement: the answer is never presented
 * without the retrieved evidence behind it.
 */
export function CitationDrawer({
  open,
  onOpenChange,
  citations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: Citation[];
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <FileSearch className="size-4 text-primary" />
            Retrieved protocol sections
          </DrawerTitle>
          <DrawerDescription>
            {citations.length === 0
              ? "No sources were retrieved for this question."
              : `${citations.length} section${citations.length === 1 ? "" : "s"} retrieved, ranked by similarity.`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {citations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in the ingested corpus matched this query.
            </p>
          ) : (
            citations.map((citation, index) => (
              <SourceCard
                key={citation.id}
                citation={citation}
                isBest={index === 0}
              />
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
