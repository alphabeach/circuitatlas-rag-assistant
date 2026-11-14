"use client";

import * as React from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";

/**
 * A PDF page, drawn on a canvas with the text on top of it.
 *
 * The canvas shows the page as printed; the text layer holds one element
 * per text run of the PDF, which is what makes it possible to mark the
 * exact lines of an answer instead of drawing a box over them.
 */

const HIT_CLASSES = ["bg-amber-300/50", "rounded-xs"];

export function PdfCanvas({
  fileUrl,
  pageNumber,
  passage,
}: {
  fileUrl: string;
  pageNumber: number;
  /** The passage to mark, or null for no mark. */
  passage: string | null;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const textLayerRef = React.useRef<TextLayer | null>(null);

  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [width, setWidth] = React.useState(0);
  /** Bumped once the text layer of the current page is on screen. */
  const [layerReady, setLayerReady] = React.useState(0);

  // The worker is a separate script; the bundler turns this into the
  // address of the emitted asset.
  React.useEffect(() => {
    GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url: fileUrl });

    void (async () => {
      try {
        const document = await task.promise;
        if (!cancelled) {
          setPdf(document);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open the PDF",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [fileUrl]);

  // Follow the width of the pane.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      setWidth((previous) =>
        Math.abs(previous - measured) > 1 ? measured : previous,
      );
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Draw the page and lay its text on top.
  React.useEffect(() => {
    if (!pdf || !canvasRef.current || !layerRef.current || width === 0) return;

    const canvas = canvasRef.current;
    const layerContainer = layerRef.current;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let drawn = false;

    // A new draw is also a retry: an error from the previous one is stale.
    setError(null);

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const scale = width / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const renderViewport = page.getViewport({
          scale: scale * outputScale,
        });

        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const context = canvas.getContext("2d");
        if (!context) return;

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        });
        await renderTask.promise;
        drawn = true;
        if (cancelled) return;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        layerContainer.replaceChildren();
        const layer = new TextLayer({
          textContentSource: textContent,
          container: layerContainer,
          viewport,
        });
        await layer.render();
        if (cancelled) return;

        textLayerRef.current = layer;
        setLayerReady((count) => count + 1);
      } catch (cause) {
        // A draw cancelled by the next effect is not a failure.
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Could not render the page",
        );
      }
    })();

    return () => {
      cancelled = true;
      // pdf.js refuses a second draw on the same canvas while one is still
      // running, so the old one has to be cancelled before the next effect
      // starts. cancel() releases the canvas synchronously.
      if (!drawn) renderTask?.cancel();
    };
  }, [pdf, pageNumber, width]);

  // Mark the passage and bring it into view.
  React.useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;

    const divs = layer.textDivs;
    const strings = layer.textContentItemsStr;

    for (const div of divs) div.classList.remove(...HIT_CLASSES);
    if (!passage) return;

    // The layer holds one element per text run; the offsets map a position
    // in the joined text back to the run that contains it.
    const offsets: number[] = [];
    let cursor = 0;
    for (const text of strings) {
      offsets.push(cursor);
      cursor += text.length + 1;
    }

    const layerText = strings.join(" ");
    const match = passagePattern(passage).exec(layerText);
    if (!match) return;

    const start = match.index;
    const end = start + match[0].length;
    let firstHit: HTMLElement | undefined;

    divs.forEach((div, index) => {
      const from = offsets[index];
      const to = from + strings[index].length;
      if (to <= start || from >= end) return;

      div.classList.add(...HIT_CLASSES);
      if (!firstHit) firstHit = div;
    });

    firstHit?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [passage, layerReady]);

  return (
    <div
      ref={containerRef}
      // A stable gutter keeps the scrollbar from changing the width when it
      // appears, which would otherwise trigger another draw at a new scale.
      className="relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
    >
      {error && (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      )}
      <div className="relative mx-auto w-fit">
        <canvas ref={canvasRef} className="block" />
        <div ref={layerRef} className="textLayer" />
      </div>
    </div>
  );
}

/**
 * Matches the passage inside the text layer regardless of how the
 * whitespace is broken up.
 */
function passagePattern(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/\s+/g, "\\s+"));
}
