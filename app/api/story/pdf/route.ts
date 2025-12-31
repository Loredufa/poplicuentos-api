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
const LINE_HEIGHT = 22;

function wrapText(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(next, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
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
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = PAGE_HEIGHT - MARGIN;

    const availableWidth = PAGE_WIDTH - MARGIN * 2;
    const upperTitle = title.toUpperCase();
    const titleSize = 22;
    const titleWidth = font.widthOfTextAtSize(upperTitle, titleSize);
    page.drawText(upperTitle, {
      x: MARGIN + (availableWidth - titleWidth) / 2,
      y,
      size: titleSize,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 32;

    const paragraphs = storyText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.toUpperCase());

    if (!paragraphs.length) paragraphs.push(storyText.toUpperCase());

    // posiciones para imágenes: después del primer párrafo, mitad, último
    const imageSlots = [0, Math.max(1, Math.floor(paragraphs.length / 2)), paragraphs.length - 1];

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const lines = wrapText(para, font, TEXT_SIZE, availableWidth);
      for (const line of lines) {
        if (y - LINE_HEIGHT < MARGIN) {
          y = PAGE_HEIGHT - MARGIN;
          pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        }
        const currentPage = pdf.getPages()[pdf.getPages().length - 1];
        currentPage.drawText(line, {
          x: MARGIN,
          y,
          size: TEXT_SIZE,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= LINE_HEIGHT;
      }

      // Insertar imagen si corresponde al slot y hay imagen disponible
      const slotIndex = imageSlots.indexOf(i);
      if (slotIndex !== -1 && images[slotIndex]) {
        const image = await embedImage(pdf, images[slotIndex]);
        const maxImgWidth = availableWidth;
        const maxImgHeight = 260;
        const scale = Math.min(
          maxImgWidth / image.width,
          maxImgHeight / image.height
        );
        const imgWidth = image.width * scale;
        const imgHeight = image.height * scale;

        if (y - imgHeight - 12 < MARGIN) {
          y = PAGE_HEIGHT - MARGIN;
          pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        }
        const currentPage = pdf.getPages()[pdf.getPages().length - 1];
        currentPage.drawImage(image, {
          x: MARGIN + (availableWidth - imgWidth) / 2,
          y: y - imgHeight,
          width: imgWidth,
          height: imgHeight,
        });
        y -= imgHeight + 18;
      }

      y -= 8;
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
