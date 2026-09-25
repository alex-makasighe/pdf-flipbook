import type { FlipDirection } from "../types/viewer.types";

export class FlipBookService {
  normalizePage(page: number, pageCount: number): number {
    return Math.min(Math.max(1, page), Math.max(1, pageCount));
  }

  next(page: number, pageCount: number, mobile: boolean): number {
    return this.normalizePage(page + (mobile ? 1 : 2), pageCount);
  }

  previous(page: number, pageCount: number, mobile: boolean): number {
    return this.normalizePage(page - (mobile ? 1 : 2), pageCount);
  }

  getDirection(deltaX: number): FlipDirection | null {
    if (Math.abs(deltaX) < 3) return null;
    return deltaX < 0 ? "next" : "previous";
  }

  progress(deltaX: number, width: number): number {
    if (width <= 0) return 0;
    return Math.min(1, Math.max(0, Math.abs(deltaX) / (width * 0.5)));
  }

  shouldCommit(progress: number, velocity: number): boolean {
    return progress >= 0.28 || velocity >= 0.8;
  }
}
