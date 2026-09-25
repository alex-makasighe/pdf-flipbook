import type { CachedPage } from "../types/viewer.types";
import { PdfService } from "./PdfService";

interface CacheEntry extends CachedPage {
  lastUsed: number;
}

export class PdfRenderCache {
  private readonly cache = new Map<number, CacheEntry>();
  private readonly controllers = new Map<number, AbortController>();

  constructor(
    private readonly pdfService: PdfService,
    private readonly maxEntries = 5
  ) {}

  get(page: number): CachedPage | null {
    const entry = this.cache.get(page);
    if (!entry) return null;

    entry.lastUsed = performance.now();
    return entry;
  }

  has(page: number): boolean {
    return this.cache.has(page);
  }

  async render(
    page: number,
    scale: number,
    canvas: HTMLCanvasElement
  ): Promise<CachedPage> {
    const existing = this.cache.get(page);

    if (existing && Math.abs(existing.scale - scale) < 0.06) {
      const context = canvas.getContext("2d");
      if (context) {
        canvas.width = existing.canvas.width;
        canvas.height = existing.canvas.height;
        canvas.style.width = existing.canvas.style.width;
        canvas.style.height = existing.canvas.style.height;
        context.drawImage(existing.canvas, 0, 0);
      }
      existing.lastUsed = performance.now();
      return existing;
    }

    this.controllers.get(page)?.abort();

    const controller = new AbortController();
    this.controllers.set(page, controller);

    try {
      const offscreen = document.createElement("canvas");

      const size = await this.pdfService.renderToCanvas(
        page,
        offscreen,
        scale,
        controller.signal
      );

      if (controller.signal.aborted) {
        throw new DOMException("Render dibatalkan.", "AbortError");
      }

      const entry: CacheEntry = {
        pageNumber: page,
        canvas: offscreen,
        width: size.width,
        height: size.height,
        scale,
        lastUsed: performance.now()
      };

      this.cache.set(page, entry);
      this.evict();

      const context = canvas.getContext("2d");
      if (context) {
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = offscreen.style.width;
        canvas.style.height = offscreen.style.height;
        context.drawImage(offscreen, 0, 0);
      }

      return entry;
    } finally {
      this.controllers.delete(page);
    }
  }

  async preload(page: number, scale: number): Promise<void> {
    if (page < 1 || this.pdfService.numPages < page) return;
    if (this.has(page)) return;

    this.controllers.get(page)?.abort();

    const controller = new AbortController();
    this.controllers.set(page, controller);

    try {
      const offscreen = document.createElement("canvas");

      const size = await this.pdfService.renderToCanvas(
        page,
        offscreen,
        scale,
        controller.signal
      );

      if (controller.signal.aborted) return;

      this.cache.set(page, {
        pageNumber: page,
        canvas: offscreen,
        width: size.width,
        height: size.height,
        scale,
        lastUsed: performance.now()
      });

      this.evict();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        // Preloading is best-effort and must never break the current page.
      }
    } finally {
      this.controllers.delete(page);
    }
  }

  clear(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }

    this.controllers.clear();
    this.cache.clear();
  }

  private evict(): void {
    while (this.cache.size > this.maxEntries) {
      let oldestPage: number | null = null;
      let oldestTime = Infinity;

      for (const [page, entry] of this.cache) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestPage = page;
        }
      }

      if (oldestPage === null) break;
      this.cache.delete(oldestPage);
    }
  }
}
