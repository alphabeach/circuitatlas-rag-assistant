"use client";

import { Loader2, Send } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type QueryInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * Natural-language query bar.
 *
 * Enter submits, Shift+Enter inserts a newline. The form is used rather
 * than a bare input so keyboard and IME behaviour stays native. It sits
 * pinned at the bottom of the workbench, so it stays one line tall.
 */
export function QueryInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = "Ask about a protocol, assay, or safety procedure...",
  className,
}: QueryInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isLoading && value.trim()) onSubmit();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoading && value.trim()) onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-end gap-2 rounded-lg border border-border bg-card p-2 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30",
        className,
      )}
    >
      <label htmlFor="query" className="sr-only">
        Ask a question about the protocols
      </label>
      <textarea
        id="query"
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      <Button
        type="submit"
        size="icon"
        disabled={isLoading || !value.trim()}
        aria-label="Ask"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </Button>
    </form>
  );
}
