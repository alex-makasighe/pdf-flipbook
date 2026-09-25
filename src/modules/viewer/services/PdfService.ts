import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfJsModule = typeof import("pdfjs-dist");

export class PdfService {
  private pdfjs: PdfJsModule | null = null;
  private document: PDFDocumentProxy | null = null;
  private loadingTask: ReturnType<PdfJsModule["getDocument"]> | null = null;
  private loadingUrl = "";

  private async getPdfJs(): Promise<PdfJsModule> {
    if (this.pdfjs) return this.pdfjs;

    if (typeof window === "undefined") {
      throw new Error("PDF.js harus dijalankan di browser.");
    }

    const pdfjs = await import("pdfjs-dist");

    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    this.pdfjs = pdfjs;
    return pdfjs;
  }

  async load(url: string): Promise<PDFDocumentProxy> {
    if (this.document && this.loadingUrl === url) {
      return this.document;
    }

    this.destroy();

    const pdfjs = await this.getPdfJs();
    this.loadingUrl = url;

    this.loadingTask = pdfjs.getDocument({
      url,
      // Let the browser/PDF.js use HTTP Range requests.
      rangeChunkSize: 1024 * 1024,
      disableAutoFetch: false,
      disableStream: false,
      useWorkerFetch: true,
      // isEvalSupported: true
    });

    this.document = await this.loadingTask.promise;
    this.loadingTask = null;

    return this.document;
  }

  async getPage(pageNumber: number): Promise<PDFPageProxy> {
    if (!this.document) {
      throw new Error("PDF belum dimuat.");
    }

    return this.document.getPage(pageNumber);
  }

  async renderToCanvas(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    signal?: AbortSignal
  ): Promise<{ width: number; height: number }> {
    const page = await this.getPage(pageNumber);

    if (signal?.aborted) {
      throw new DOMException("Render dibatalkan.", "AbortError");
    }

    const viewport = page.getViewport({ scale });
    const maxDpr = 1.75;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false,
    });

    if (!context) {
      throw new Error("Canvas 2D tidak tersedia.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });

    if (signal) {
      const abortHandler = () => renderTask.cancel();
      signal.addEventListener("abort", abortHandler, { once: true });

      try {
        await renderTask.promise;
      } finally {
        signal.removeEventListener("abort", abortHandler);
      }
    } else {
      await renderTask.promise;
    }

    return { width, height };
  }

  async renderToDataUrl(pageNumber: number, scale = 0.16): Promise<string> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const dpr = 1;

    canvas.width = Math.ceil(viewport.width * dpr);
    canvas.height = Math.ceil(viewport.height * dpr);

    const context = canvas.getContext("2d", {
      alpha: false,
    });

    if (!context) {
      throw new Error("Canvas 2D tidak tersedia.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    return canvas.toDataURL("image/jpeg", 0.72);
  }

  get numPages(): number {
    return this.document?.numPages ?? 0;
  }

  get isLoaded(): boolean {
    return this.document !== null;
  }

  destroy(): void {
    try {
      this.loadingTask?.destroy();
    } catch {}

    try {
      void this.document?.destroy();
    } catch {}

    this.loadingTask = null;
    this.document = null;
    this.loadingUrl = "";
  }
}
