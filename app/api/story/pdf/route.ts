export const runtime = "nodejs";

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

type PdfBody = {
  title?: string;
  story_text?: string;
  images?: string[]; // URLs absolutas o data URIs
};

function isPdfBody(input: unknown): input is PdfBody {
  if (typeof input !== "object" || input === null) return false;
  const data = input as Record<string, unknown>;
  const isString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (data.title !== undefined && !isString(data.title)) return false;
  if (data.story_text !== undefined && !isString(data.story_text)) return false;
  if (data.images !== undefined && !Array.isArray(data.images)) return false;
  return true;
}

const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const TEXT_SIZE = 16;
const MIN_TEXT_SIZE = 11;
const LINE_HEIGHT_RATIO = 1.35;
const PAGE_COUNT = 3;
const IMAGE_BOX_WIDTH = 220;
const IMAGE_BOX_HEIGHT = 260;
const IMAGE_GUTTER = 14;
const TITLE_GAP = 10;
const SUBTITLE_GAP = 12;
const STAMP_SIZE = 56;
const STAMP_ROTATION = -8;
const SHADOW_OFFSET = 6;
const SHADOW_OPACITY = 0.22;

type LayoutLine = { text: string; pageIndex: number; x: number; y: number };
type TextBox = { pageIndex: number; x: number; yTop: number; width: number; height: number };

function getLineHeight(fontSize: number) {
  return fontSize * LINE_HEIGHT_RATIO;
}

function getPageStartY(pageIndex: number, titleBlock: number) {
  return PAGE_HEIGHT - MARGIN - (pageIndex === 0 ? titleBlock : 0);
}

function buildTextBoxes(titleBlock: number, imagePages: boolean[]) {
  const boxes: TextBox[] = [];
  const availableWidth = PAGE_WIDTH - MARGIN * 2;
  const narrowWidth = availableWidth - IMAGE_BOX_WIDTH - IMAGE_GUTTER;

  for (let pageIndex = 0; pageIndex < PAGE_COUNT; pageIndex += 1) {
    const textStartY = getPageStartY(pageIndex, titleBlock);
    if (imagePages[pageIndex]) {
      boxes.push({
        pageIndex,
        x: MARGIN,
        yTop: textStartY,
        width: narrowWidth,
        height: IMAGE_BOX_HEIGHT,
      });
    }
    const remainingTop = textStartY - (imagePages[pageIndex] ? IMAGE_BOX_HEIGHT : 0);
    const remainingHeight = remainingTop - MARGIN;
    if (remainingHeight > 0) {
      boxes.push({
        pageIndex,
        x: MARGIN,
        yTop: remainingTop,
        width: availableWidth,
        height: remainingHeight,
      });
    }
  }

  return boxes;
}

function splitLongWord(word: string, font: any, fontSize: number, maxWidth: number) {
  const parts: string[] = [];
  let current = "";
  for (const ch of word) {
    const next = current + ch;
    if (font.widthOfTextAtSize(next, fontSize) > maxWidth && current) {
      parts.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function layoutStoryText(opts: {
  text: string;
  font: any;
  fontSize: number;
  titleBlock: number;
  imagePages: boolean[];
}) {
  const { text, font, fontSize, titleBlock, imagePages } = opts;
  const lineHeight = getLineHeight(fontSize);
  const paragraphGap = lineHeight * 0.6;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const boxes = buildTextBoxes(titleBlock, imagePages);
  const lines: LayoutLine[] = [];
  let boxIndex = 0;
  let currentBox = boxes[boxIndex];
  let y = currentBox?.yTop ?? 0;
  let minY = currentBox ? currentBox.yTop - currentBox.height : 0;

  const nextBox = () => {
    boxIndex += 1;
    if (boxIndex >= boxes.length) return false;
    currentBox = boxes[boxIndex];
    y = currentBox.yTop;
    minY = currentBox.yTop - currentBox.height;
    return true;
  };

  const ensureSpace = () => {
    if (!currentBox) return false;
    if (y - lineHeight < minY) {
      return nextBox();
    }
    return true;
  };

  const pushLine = (line: string) => {
    if (!line) return true;
    if (!ensureSpace() || !currentBox) return false;
    lines.push({ text: line, pageIndex: currentBox.pageIndex, x: currentBox.x, y });
    y -= lineHeight;
    return true;
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      if (!currentBox) return { lines, overflow: true };
      const maxWidth = currentBox.width;
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
        continue;
      }
      if (current) {
        if (!pushLine(current)) return { lines, overflow: true };
        current = "";
      }
      const wordWidth = font.widthOfTextAtSize(word, fontSize);
      if (wordWidth <= maxWidth) {
        current = word;
        continue;
      }
      const chunks = splitLongWord(word, font, fontSize, maxWidth);
      for (const chunk of chunks) {
        if (!pushLine(chunk)) return { lines, overflow: true };
      }
    }
    if (current) {
      if (!pushLine(current)) return { lines, overflow: true };
    }
    y -= paragraphGap;
    while (currentBox && y < minY) {
      if (!nextBox()) return { lines, overflow: true };
    }
  }

  return { lines, overflow: false };
}

async function embedImage(pdf: PDFDocument, url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
  return isPng
    ? pdf.embedPng(bytes)
    : pdf.embedJpg(bytes); // fallback a JPG por simplicidad
}

async function embedLocalPng(pdf: PDFDocument, absolutePath: string) {
  const bytes = await readFile(absolutePath);
  return pdf.embedPng(bytes);
}

function toUpperImprint(text: string) {
  return text.toLocaleUpperCase("es-ES");
}

async function loadStampLogo(pdf: PDFDocument) {
  const candidates = [
    path.resolve(process.cwd(), "logo", "logo.png"),
    path.resolve(process.cwd(), "..", "logo", "logo.png"),
  ];

  for (const candidate of candidates) {
    try {
      return await embedLocalPng(pdf, candidate);
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => null);
    if (!isPdfBody(raw)) {
      return jsonWithCors(
        req,
        { error: "Cuerpo inválido. Envia story_text y opcional title, images[]" },
        { status: 400 }
      );
    }

    const storyText = (raw.story_text || "").trim();
    const title = raw.title?.trim() || "Cuento infantil";
    const images = (raw.images || []).slice(0, 3);

    if (!storyText) {
      return jsonWithCors(
        req,
        { error: "Falta story_text con el cuento." },
        { status: 400 }
      );
    }

    const pdf = await PDFDocument.create();
    const pages = Array.from({ length: PAGE_COUNT }, () =>
      pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    );
    const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

    const availableWidth = PAGE_WIDTH - MARGIN * 2;
    const displayTitle = toUpperImprint(title.trim());
    const titleSize = 22;
    const titleWidth = titleFont.widthOfTextAtSize(displayTitle, titleSize);
    const titleTopY = PAGE_HEIGHT - MARGIN;
    pages[0].drawText(displayTitle, {
      x: MARGIN + (availableWidth - titleWidth) / 2,
      y: titleTopY,
      size: titleSize,
      font: titleFont,
      color: rgb(0.1, 0.1, 0.1),
    });

    let cleanedText = storyText.trim();
    const firstLine = cleanedText.split(/\r?\n/)[0]?.trim() || "";
    if (firstLine.toLowerCase() === displayTitle.toLowerCase()) {
      cleanedText = cleanedText.replace(firstLine, "").trimStart();
    }

    let subtitle = "";
    const metaMatch = cleanedText.match(/^\s*(META:[^\n]+)\n+/i);
    if (metaMatch) {
      subtitle = metaMatch[1].trim();
      cleanedText = cleanedText.slice(metaMatch[0].length).trimStart();
    }

    const subtitleSize = 11;
    const imprintSubtitle = subtitle
      ? toUpperImprint(subtitle)
      : "BY POPLICUENTOS";
    pages[0].drawText(imprintSubtitle, {
      x: MARGIN,
      y: titleTopY - titleSize - TITLE_GAP,
      size: subtitleSize,
      font: bodyFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    const titleBlock =
      titleSize +
      TITLE_GAP +
      subtitleSize +
      SUBTITLE_GAP;

    const paragraphs = cleanedText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const fullText = toUpperImprint(
      paragraphs.length ? paragraphs.join("\n\n") : cleanedText
    );
    const imagePages = Array.from({ length: PAGE_COUNT }, (_, i) => Boolean(images[i]));

    let chosenSize = TEXT_SIZE;
    let layout = layoutStoryText({
      text: fullText,
      font: bodyFont,
      fontSize: chosenSize,
      titleBlock,
      imagePages,
    });

    while (layout.overflow && chosenSize > MIN_TEXT_SIZE) {
      chosenSize -= 1;
      layout = layoutStoryText({
        text: fullText,
        font: bodyFont,
        fontSize: chosenSize,
        titleBlock,
        imagePages,
      });
    }

    if (layout.overflow && layout.lines.length) {
      const last = layout.lines[layout.lines.length - 1];
      last.text = `${last.text.replace(/[.]+$/, "")}...`;
    }

    for (const line of layout.lines) {
      pages[line.pageIndex].drawText(line.text, {
        x: line.x,
        y: line.y,
        size: chosenSize,
        font: bodyFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    }

    for (let i = 0; i < PAGE_COUNT; i++) {
      if (!images[i]) continue;
      const image = await embedImage(pdf, images[i]);
      const scale = Math.min(
        IMAGE_BOX_WIDTH / image.width,
        IMAGE_BOX_HEIGHT / image.height
      );
      const imgWidth = image.width * scale;
      const imgHeight = image.height * scale;
      const textStartY = getPageStartY(i, titleBlock);
      const imgX =
        PAGE_WIDTH -
        MARGIN -
        IMAGE_BOX_WIDTH +
        (IMAGE_BOX_WIDTH - imgWidth) / 2;
      const imgY =
        textStartY - IMAGE_BOX_HEIGHT + (IMAGE_BOX_HEIGHT - imgHeight) / 2;
      pages[i].drawRectangle({
        x: imgX + SHADOW_OFFSET,
        y: imgY - SHADOW_OFFSET,
        width: imgWidth,
        height: imgHeight,
        color: rgb(0, 0, 0),
        opacity: SHADOW_OPACITY,
      });
      pages[i].drawImage(image, {
        x: imgX,
        y: imgY,
        width: imgWidth,
        height: imgHeight,
      });
    }

    const stamp = await loadStampLogo(pdf);
    if (stamp) {
      const stampScale = STAMP_SIZE / Math.max(stamp.width, stamp.height);
      const stampWidth = stamp.width * stampScale;
      const stampHeight = stamp.height * stampScale;
      pages[0].drawImage(stamp, {
        x: MARGIN - 6,
        y: PAGE_HEIGHT - MARGIN - stampHeight + 8,
        width: stampWidth,
        height: stampHeight,
        rotate: degrees(STAMP_ROTATION),
      });
    }

    const pdfBytes = await pdf.save();
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cuento-poplicuentos.pdf"`,
    };
    return new Response(Buffer.from(pdfBytes), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo generar el PDF";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
