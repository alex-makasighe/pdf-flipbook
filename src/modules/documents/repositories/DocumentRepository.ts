import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { DocumentMetadata } from "../types/document.types";

const STORAGE_DIR = path.resolve("storage/pdf");
const META_DIR = path.resolve("storage/meta");

function metaPath(id: string): string {
  return path.join(META_DIR, `${id}.json`);
}

function pdfPath(id: string): string {
  return path.join(STORAGE_DIR, `${id}.pdf`);
}

export class DocumentRepository {
  async initialize(): Promise<void> {
    await mkdir(STORAGE_DIR, { recursive: true });
    await mkdir(META_DIR, { recursive: true });
  }

  async save(
    id: string,
    buffer: Buffer,
    metadata: DocumentMetadata
  ): Promise<DocumentMetadata> {
    await this.initialize();
    await writeFile(pdfPath(id), buffer);
    await writeFile(metaPath(id), JSON.stringify(metadata, null, 2), "utf8");
    return metadata;
  }

  async findById(id: string): Promise<DocumentMetadata | null> {
    await this.initialize();

    try {
      const data = await readFile(metaPath(id), "utf8");
      return JSON.parse(data) as DocumentMetadata;
    } catch {
      return null;
    }
  }

  async findAll(): Promise<DocumentMetadata[]> {
    await this.initialize();

    const entries = await readdir(META_DIR);
    const documents: DocumentMetadata[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const data = await readFile(path.join(META_DIR, entry), "utf8");
        documents.push(JSON.parse(data) as DocumentMetadata);
      } catch {
        // Ignore malformed metadata files.
      }
    }

    return documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(id: string): Promise<boolean> {
    try {
      await unlink(pdfPath(id));
    } catch {}

    try {
      await unlink(metaPath(id));
      return true;
    } catch {
      return false;
    }
  }

  getPdfPath(id: string): string {
    return pdfPath(id);
  }

  async getPdfStat(id: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(pdfPath(id));
      return { size: info.size };
    } catch {
      return null;
    }
  }

  createPdfStream(id: string, start?: number, end?: number) {
    return Readable.toWeb(
      createReadStream(pdfPath(id), {
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {})
      })
    );
  }
}
