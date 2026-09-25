export type FlipDirection = "next" | "previous";

export interface RenderOptions {
  scale: number;
  pixelRatio: number;
}

export interface CachedPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
}

export interface ThumbnailItem {
  page: number;
  dataUrl?: string;
}
