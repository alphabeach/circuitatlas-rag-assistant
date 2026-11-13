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
  suggestions?: string[];
  className?: string;
};

/**
 * Natural-language query bar.
 *
 * Enter submits, Shift+Enter inserts a newline. The form is used rather
 * than a bare input so keyboard and IME behaviour stays native.
 */
export function QueryInput({
  value,
  onChange,
  onSubmit,
  isLoading = false,
  placeholder = "Ask about a protocol, assay, or safety procedure...",
  suggestions = [],
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

  const handleSuggestion = (suggestion: string) => {
    onChange(suggestion);
    textareaRef.current?.focus();
  };

  return (
    <div className={cn("space-y-3", className)}>
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30"
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
          rows={3}
          className="w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        <div className="flex items-center justify-between gap-3 px-1 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Enter to ask &middot; Shift+Enter for a new line
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={isLoading || !value.trim()}
            className="gap-1.5"
          >
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {isLoading ? "Retrieving" : "Ask"}
          </Button>
        </div>
      </form>

      {suggestions.length > 0 && !value && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleSuggestion(suggestion)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
