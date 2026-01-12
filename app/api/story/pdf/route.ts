export const runtime = "nodejs";

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextRequest } from "next/server";

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
const IMAGE_BOX_WIDTH = 200;
const IMAGE_BOX_HEIGHT = 240;
const IMAGE_GUTTER = 14;

type LayoutLine = { text: string; pageIndex: number; x: number; y: number };

function getLineHeight(fontSize: number) {
  return fontSize * LINE_HEIGHT_RATIO;
}

function getPageStartY(pageIndex: number, titleBlock: number) {
  return PAGE_HEIGHT - MARGIN - (pageIndex === 0 ? titleBlock : 0);
}

function getLineWidth(y: number, textStartY: number, hasImage: boolean) {
  const imageTop = textStartY;
  const imageBottom = textStartY - IMAGE_BOX_HEIGHT;
  const availableWidth = PAGE_WIDTH - MARGIN * 2;
  const narrowWidth = availableWidth - IMAGE_BOX_WIDTH - IMAGE_GUTTER;
  const inImageBand = y <= imageTop && y > imageBottom;
  return inImageBand && hasImage ? narrowWidth : availableWidth;
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
  maxPages: number;
  imagePages: boolean[];
}) {
  const { text, font, fontSize, titleBlock, maxPages, imagePages } = opts;
  const lineHeight = getLineHeight(fontSize);
  const paragraphGap = lineHeight * 0.6;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const lines: LayoutLine[] = [];
  let pageIndex = 0;
  let textStartY = getPageStartY(pageIndex, titleBlock);
  let y = textStartY;

  const nextPage = () => {
    pageIndex += 1;
    if (pageIndex >= maxPages) return false;
    textStartY = getPageStartY(pageIndex, titleBlock);
    y = textStartY;
    return true;
  };

  const ensureSpace = () => {
    if (y - lineHeight < MARGIN) {
      return nextPage();
    }
    return true;
  };

  const pushLine = (line: string) => {
    if (!line) return true;
    if (!ensureSpace()) return false;
    lines.push({ text: line, pageIndex, x: MARGIN, y });
    y -= lineHeight;
    return true;
  };

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const maxWidth = getLineWidth(y, textStartY, imagePages[pageIndex]);
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
        continue;
      }
      if (current) {
        if (!pushLine(current)) return { lines, pagesUsed: pageIndex + 1, overflow: true };
        current = "";
      }
      const wordWidth = font.widthOfTextAtSize(word, fontSize);
      if (wordWidth <= maxWidth) {
        current = word;
        continue;
      }
      const chunks = splitLongWord(word, font, fontSize, maxWidth);
      for (const chunk of chunks) {
        if (!pushLine(chunk)) return { lines, pagesUsed: pageIndex + 1, overflow: true };
      }
    }
    if (current) {
      if (!pushLine(current)) return { lines, pagesUsed: pageIndex + 1, overflow: true };
    }
    y -= paragraphGap;
    if (y < MARGIN && !nextPage()) {
      return { lines, pagesUsed: pageIndex + 1, overflow: true };
    }
  }

  return { lines, pagesUsed: pageIndex + 1, overflow: false };
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
    const upperTitle = title.toUpperCase();
    const titleSize = 22;
    const titleWidth = titleFont.widthOfTextAtSize(upperTitle, titleSize);
    pages[0].drawText(upperTitle, {
      x: MARGIN + (availableWidth - titleWidth) / 2,
      y: PAGE_HEIGHT - MARGIN,
      size: titleSize,
      font: titleFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    const titleBlock = titleSize + 14;

    const paragraphs = storyText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.toUpperCase());

    if (!paragraphs.length) paragraphs.push(storyText.toUpperCase());
    const fullText = paragraphs.join("\n\n");
    const imagePages = Array.from({ length: PAGE_COUNT }, (_, i) => Boolean(images[i]));

    let chosenSize = TEXT_SIZE;
    let layout = layoutStoryText({
      text: fullText,
      font: bodyFont,
      fontSize: chosenSize,
      titleBlock,
      maxPages: PAGE_COUNT,
      imagePages,
    });

    while (layout.overflow && chosenSize > MIN_TEXT_SIZE) {
      chosenSize -= 1;
      layout = layoutStoryText({
        text: fullText,
        font: bodyFont,
        fontSize: chosenSize,
        titleBlock,
        maxPages: PAGE_COUNT,
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
      const imgX = PAGE_WIDTH - MARGIN - IMAGE_BOX_WIDTH + (IMAGE_BOX_WIDTH - imgWidth) / 2;
      const imgY = textStartY - imgHeight;
      pages[i].drawImage(image, {
        x: imgX,
        y: imgY,
        width: imgWidth,
        height: imgHeight,
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
