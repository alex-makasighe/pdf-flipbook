import { randomUUID } from "node:crypto";
import type { DocumentMetadata } from "../types/document.types";
import { DocumentRepository } from "../repositories/DocumentRepository";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export class DocumentService {
  constructor(private readonly repository = new DocumentRepository()) {}

  async list(): Promise<DocumentMetadata[]> {
    return this.repository.findAll();
  }

  async get(id: string): Promise<DocumentMetadata | null> {
    return this.repository.findById(id);
  }

  async upload(file: File): Promise<DocumentMetadata> {
    if (file.type !== "application/pdf") {
      throw new Error("File harus berupa PDF.");
    }

    if (file.size <= 0) {
      throw new Error("File PDF kosong.");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Ukuran PDF maksimal 100 MB.");
    }

    const id = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());

    const metadata: DocumentMetadata = {
      id,
      filename: `${id}.pdf`,
      originalName: file.name,
      size: file.size,
      mimeType: "application/pdf",
      createdAt: new Date().toISOString()
    };

    await this.repository.save(id, buffer, metadata);
    return metadata;
  }

  async delete(id: string): Promise<boolean> {
    return this.repository.delete(id);
  }

  async getPdfResponse(id: string, rangeHeader: string | null): Promise<Response> {
    const document = await this.get(id);
    if (!document) return new Response("Not Found", { status: 404 });

    const info = await this.repository.getPdfStat(id);
    if (!info) return new Response("Not Found", { status: 404 });

    const total = info.size;

    if (!rangeHeader) {
      const stream = this.repository.createPdfStream(id);
      return new Response(stream as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(total),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400, immutable"
        }
      });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      return new Response("Invalid Range", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` }
      });
    }

    const startValue = match[1];
    const endValue = match[2];

    let start: number;
    let end: number;

    if (startValue === "" && endValue !== "") {
      const suffix = Number(endValue);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        return new Response("Invalid Range", { status: 416 });
      }
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = Number(startValue);
      end = endValue === "" ? total - 1 : Number(endValue);
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= total ||
      start > end
    ) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` }
      });
    }

    end = Math.min(end, total - 1);

    const length = end - start + 1;
    const stream = this.repository.createPdfStream(id, start, end);

    return new Response(stream as BodyInit, {
      status: 206,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(length),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400, immutable"
      }
    });
  }
}
