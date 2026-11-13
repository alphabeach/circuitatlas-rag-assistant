/*
 * Generates a realistic multi-page SOP PDF for testing the PDF parser.
 *
 * Written by hand as raw PDF syntax so the test suite has no PDF-generation
 * dependency. Produces 3 pages with numbered section headings, body text,
 * and a SAFETY section in all caps - which is what the heading detector
 * should pick up.
 *
 * Usage: npx tsx scripts/make-sample-pdf.ts [outputPath]
 */

import { writeFileSync } from "node:fs";

type Line = { text: string; size: number; bold: boolean };

const PAGE_CONTENT: Line[][] = [
  [
    { text: "SOP-1142  Cell Lysis and Protein Extraction", size: 18, bold: true },
    { text: "", size: 12, bold: false },
    { text: "1. Purpose", size: 14, bold: true },
    {
      text: "This procedure describes the standard operating procedure for lysing mammalian cells and extracting total protein for downstream quantification.",
      size: 11,
      bold: false,
    },
    { text: "", size: 11, bold: false },
    { text: "2. Materials", size: 14, bold: true },
    {
      text: "RIPA lysis buffer, protease inhibitor cocktail, benchtop centrifuge, 1.5 mL microcentrifuge tubes.",
      size: 11,
      bold: false,
    },
  ],
  [
    { text: "3. Procedure", size: 14, bold: true },
    {
      text: "3.1 Pellet the cells at 300 x g for 5 minutes at 4 C.",
      size: 11,
      bold: false,
    },
    {
      text: "3.2 Aspirate the supernatant and resuspend the pellet in 500 uL of ice-cold RIPA buffer containing 1x protease inhibitor.",
      size: 11,
      bold: false,
    },
    {
      text: "3.3 Incubate on ice for 15 minutes, vortexing briefly every 5 minutes.",
      size: 11,
      bold: false,
    },
    {
      text: "3.4 Centrifuge at 12,000 x g for 10 minutes at 4 C and transfer the clear supernatant to a fresh tube.",
      size: 11,
      bold: false,
    },
  ],
  [
    { text: "4. SAFETY REQUIREMENTS", size: 14, bold: true },
    {
      text: "Wear nitrile gloves, a lab coat, and eye protection at all times. RIPA buffer contains detergents and is hazardous; handle all waste in the designated chemical waste container.",
      size: 11,
      bold: false,
    },
    { text: "", size: 11, bold: false },
    { text: "5. Acceptance Criteria", size: 14, bold: true },
    {
      text: "Protein concentration must be between 0.5 and 5.0 mg/mL. Samples outside this range must be diluted and re-measured before use.",
      size: 11,
      bold: false,
    },
  ],
];

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPage(lines: Line[]): string {
  // A single BT/ET block with absolute positioning (Tm) per line. Using
  // one block matters: each BT resets the text matrix, so separate blocks
  // would stack every line at the origin.
  const content = lines
    .map((line, index) => {
      if (!line.text) return "";
      const font = line.bold ? "/F2" : "/F1";
      const y = 750 - index * 18;
      return `BT ${font} ${line.size} Tf 1 0 0 1 54 ${y} Tm (${escapePdf(line.text)}) Tj ET`;
    })
    .filter(Boolean)
    .join("\n");

  return content;
}

function buildPdf(pages: Line[][]): Buffer {
  const objects: string[] = [];
  // Object numbering: 1 catalog, 2 pages, 3 regular font, 4 bold font,
  // then alternating page/content pairs starting at 5.
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((lines, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = buildPage(lines);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  const maxId = objects.length - 1;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    pdf += offsets[id]
      ? `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
      : "0000000000 65535 f \n";
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

const output = process.argv[2] ?? "tests/fixtures/sop-sample.pdf";
writeFileSync(output, buildPdf(PAGE_CONTENT));
console.log(`Wrote ${output} (${PAGE_CONTENT.length} pages)`);
