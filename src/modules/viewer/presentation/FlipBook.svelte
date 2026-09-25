<script lang="ts">
  import { onDestroy } from "svelte";
  import { FlipBookService } from "../services/FlipBookService";
  import { PdfService } from "../services/PdfService";
  import { PdfRenderCache } from "../services/PdfRenderCache";
  import type { FlipDirection } from "../types/viewer.types";

  interface Props {
    pdfUrl: string;
    page: number;
    zoom: number;
    onPageChange: (page: number) => void;
    onPageCount: (count: number) => void;
    onPdfReady: (service: PdfService) => void;
  }

  let { pdfUrl, page, zoom, onPageChange, onPageCount, onPdfReady }: Props =
    $props();

  const flipService = new FlipBookService();
  const pdfService = new PdfService();
  const cache = new PdfRenderCache(pdfService, 8);

  let host = $state<HTMLDivElement | null>(null);

  let leftCanvas = $state<HTMLCanvasElement | null>(null);
  let rightCanvas = $state<HTMLCanvasElement | null>(null);

  /*
   * Canvas khusus untuk halaman yang sedang dibalik.
   *
   * Front:
   *   halaman yang sedang terlihat dan dibalik
   *
   * Back:
   *   halaman tujuan setelah flip
   */
  let turnFrontCanvas = $state<HTMLCanvasElement | null>(null);
  let turnBackCanvas = $state<HTMLCanvasElement | null>(null);

  let loading = $state(true);
  let error = $state("");
  let mobile = $state(false);

  let flipping = $state(false);

  let flipDirection = $state<FlipDirection | null>(null);
  let flipProgress = $state(0);
  let flipShadow = $state(0);

  let pointerId = $state<number | null>(null);
  let pointerStartX = $state(0);
  let pointerCurrentX = $state(0);
  let pointerStartTime = $state(0);

  /*
   * Digunakan supaya halaman depan tidak perlu
   * dirender ulang hanya untuk memulai gesture.
   */
  let preparedDirection = $state<FlipDirection | null>(null);

  let preparingTurn = false;

  function updateMobile(): void {
    mobile = window.matchMedia("(max-width: 767px)").matches;
  }

  function spreadStart(current: number): number {
    if (mobile) {
      return current;
    }

    return current % 2 === 0 ? current : Math.max(1, current - 1);
  }

  function spreadEnd(current: number): number {
    if (mobile) {
      return current;
    }

    return current % 2 === 1 ? current : current + 1;
  }

  function calculateScale(): number {
    const width = host?.clientWidth ?? 1000;

    const targetWidth = mobile ? width * 0.82 : width * 0.39;

    return Math.min(1.6, Math.max(0.65, targetWidth / 700)) * zoom;
  }

  async function renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement | null,
    scale: number
  ): Promise<void> {
    if (!canvas || pageNumber < 1 || pageNumber > pdfService.numPages) {
      return;
    }

    await cache.render(pageNumber, scale, canvas);
  }

  async function preloadAround(current: number, scale: number): Promise<void> {
    const pages = mobile
      ? [current - 1, current + 1, current + 2]
      : [
          spreadStart(current) - 2,
          spreadStart(current) - 1,
          spreadEnd(current) + 1,
          spreadEnd(current) + 2,
        ];

    for (const pageNumber of pages) {
      if (pageNumber >= 1 && pageNumber <= pdfService.numPages) {
        void cache.preload(pageNumber, scale);
      }
    }
  }

  async function renderCurrent(): Promise<void> {
    if (!pdfService.isLoaded) {
      return;
    }

    loading = true;
    error = "";

    try {
      const scale = calculateScale();

      if (mobile) {
        await renderPage(page, rightCanvas, scale);
      } else {
        const left = spreadStart(page);
        const right = spreadEnd(page);

        await renderPage(left, leftCanvas, scale);

        if (right <= pdfService.numPages) {
          await renderPage(right, rightCanvas, scale);
        }
      }

      loading = false;

      void preloadAround(page, scale);
    } catch (err) {
      loading = false;

      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      error = err instanceof Error ? err.message : "Gagal merender PDF.";
    }
  }

  function resetFlip(): void {
    flipProgress = 0;
    flipShadow = 0;
    flipDirection = null;
    preparedDirection = null;
  }

  /*
   * Menentukan halaman yang sedang dibalik.
   */
  function getFrontPage(direction: FlipDirection): number {
    if (mobile) {
      return page;
    }

    return direction === "next" ? spreadEnd(page) : spreadStart(page);
  }

  /*
   * Copy halaman yang sekarang terlihat ke canvas
   * animasi.
   *
   * Ini membuat gesture bisa langsung bergerak
   * tanpa menunggu PDF.js render ulang.
   */
  function copyCanvas(
    source: HTMLCanvasElement | null,
    target: HTMLCanvasElement | null
  ): void {
    if (!source || !target) {
      return;
    }

    if (source.width === 0 || source.height === 0) {
      return;
    }

    target.width = source.width;
    target.height = source.height;

    const context = target.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, target.width, target.height);

    context.drawImage(source, 0, 0);
  }

  /*
   * Menyiapkan dua sisi halaman flip.
   */
  async function prepareTurn(direction: FlipDirection): Promise<void> {
    if (preparingTurn) {
      return;
    }

    const target =
      direction === "next"
        ? flipService.next(page, pdfService.numPages, mobile)
        : flipService.previous(page, pdfService.numPages, mobile);

    if (target === page) {
      return;
    }

    preparingTurn = true;

    try {
      /*
       * FRONT
       *
       * Next:
       *   halaman kanan
       *
       * Previous:
       *   halaman kiri
       */
      const frontCanvas = mobile
        ? rightCanvas
        : direction === "next"
          ? rightCanvas
          : leftCanvas;

      copyCanvas(frontCanvas, turnFrontCanvas);

      /*
       * BACK
       *
       * Render halaman tujuan.
       */
      await renderPage(target, turnBackCanvas, calculateScale());

      preparedDirection = direction;
    } finally {
      preparingTurn = false;
    }
  }

  /*
   * Ease-out untuk animasi ketika gesture dilepas.
   */
  function easeOutCubic(value: number): number {
    return 1 - Math.pow(1 - value, 3);
  }

  /*
   * Animasi progress dari posisi sekarang
   * menuju target.
   */
  async function animateTo(target: number, duration: number): Promise<void> {
    const start = flipProgress;

    const delta = target - start;

    const started = performance.now();

    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const elapsed = now - started;

        const t = Math.min(1, elapsed / duration);

        const eased = easeOutCubic(t);

        flipProgress = start + delta * eased;

        /*
         * Shadow paling kuat sekitar
         * pertengahan flip.
         */
        flipShadow = Math.sin(flipProgress * Math.PI);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(frame);
    });
  }

  async function commitFlip(direction: FlipDirection): Promise<void> {
    if (flipping) {
      return;
    }

    const target =
      direction === "next"
        ? flipService.next(page, pdfService.numPages, mobile)
        : flipService.previous(page, pdfService.numPages, mobile);

    if (target === page) {
      resetFlip();
      return;
    }

    flipping = true;
    flipDirection = direction;

    try {
      /*
       * Pastikan kedua sisi halaman sudah tersedia.
       */
      await prepareTurn(direction);

      /*
       * Jika gesture sebelumnya belum sempat
       * menyiapkan halaman target.
       */
      if (preparedDirection !== direction) {
        await prepareTurn(direction);
      }

      /*
       * Selesaikan flip.
       */
      await animateTo(1, 900);

      /*
       * Sekarang halaman utama berubah.
       */
      onPageChange(target);

      /*
       * Beri sedikit waktu supaya DOM
       * halaman utama menggantikan halaman flip.
       */
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 30);
      });

      resetFlip();

      flipping = false;

      void preloadAround(target, calculateScale());
    } catch (err) {
      resetFlip();
      flipping = false;

      if (!(err instanceof DOMException && err.name === "AbortError")) {
        error = err instanceof Error ? err.message : "Gagal membalik halaman.";
      }
    }
  }

  async function cancelFlip(): Promise<void> {
    if (flipping || flipProgress <= 0) {
      resetFlip();
      return;
    }

    await animateTo(0, 260);

    resetFlip();
  }

  function onPointerDown(event: PointerEvent): void {
    if (flipping || loading) {
      return;
    }

    pointerId = event.pointerId;

    pointerStartX = event.clientX;

    pointerCurrentX = event.clientX;

    pointerStartTime = performance.now();

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId || flipping) {
      return;
    }

    pointerCurrentX = event.clientX;

    const delta = pointerCurrentX - pointerStartX;

    const direction = flipService.getDirection(delta);

    if (!direction) {
      return;
    }

    const target =
      direction === "next"
        ? flipService.next(page, pdfService.numPages, mobile)
        : flipService.previous(page, pdfService.numPages, mobile);

    /*
     * Tidak ada halaman lagi.
     */
    if (target === page) {
      return;
    }

    /*
     * Direction berubah.
     */
    if (preparedDirection !== direction) {
      preparedDirection = null;

      void prepareTurn(direction);
    }

    flipDirection = direction;

    flipProgress = flipService.progress(
      delta,
      mobile ? (host?.clientWidth ?? 1) : (host?.clientWidth ?? 1) / 2
    );

    flipShadow = Math.sin(flipProgress * Math.PI);
  }

  async function onPointerUp(event: PointerEvent): Promise<void> {
    if (pointerId !== event.pointerId) {
      return;
    }

    const delta = pointerCurrentX - pointerStartX;

    const elapsed = Math.max(1, performance.now() - pointerStartTime);

    const velocity = (Math.abs(delta) / elapsed) * 3;

    const direction = flipService.getDirection(delta);

    const progress = flipService.progress(
      delta,
      mobile ? (host?.clientWidth ?? 1) : (host?.clientWidth ?? 1) / 2
    );

    pointerId = null;

    if (!direction) {
      resetFlip();
      return;
    }

    if (flipService.shouldCommit(progress, velocity)) {
      await commitFlip(direction);
    } else {
      await cancelFlip();
    }
  }

  function onPointerCancel(): void {
    pointerId = null;

    if (!flipping) {
      void cancelFlip();
    }
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "ArrowRight") {
      void commitFlip("next");
    }

    if (event.key === "ArrowLeft") {
      void commitFlip("previous");
    }
  }

  /*
   * Window events.
   */
  $effect(() => {
    updateMobile();

    window.addEventListener("resize", updateMobile);

    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("resize", updateMobile);

      window.removeEventListener("keydown", handleKey);
    };
  });

  /*
   * Load PDF.
   */
  $effect(() => {
    void pdfUrl;

    let cancelled = false;

    (async () => {
      try {
        await pdfService.load(pdfUrl);

        if (cancelled) {
          return;
        }

        onPageCount(pdfService.numPages);

        onPdfReady(pdfService);

        await renderCurrent();
      } catch (err) {
        if (!cancelled) {
          loading = false;

          error = err instanceof Error ? err.message : "Gagal membuka PDF.";
        }
      }
    })();

    return () => {
      cancelled = true;

      cache.clear();
      pdfService.destroy();
    };
  });

  /*
   * Render ketika page / zoom / mobile berubah.
   */
  $effect(() => {
    void page;
    void zoom;
    void mobile;

    if (pdfService.isLoaded && !flipping) {
      void renderCurrent();
    }
  });

  onDestroy(() => {
    cache.clear();
    pdfService.destroy();
  });
</script>

<div
  bind:this={host}
  role="application"
  class="relative flex h-full min-h-0 w-full touch-none select-none items-center justify-center overflow-hidden"
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerCancel}
>
  <div
    class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.06),transparent_52%)]"
  ></div>

  {#if error}
    <div
      class="relative z-30 rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-sm text-red-300"
    >
      {error}
    </div>
  {:else}
    <div
      class:mobile
      class:desktop={!mobile}
      class="book-stage relative flex items-center justify-center"
    >
      <div class="book-shadow"></div>

      <div class:single={mobile} class="book-spread">
        {#if !mobile}
          <div class="page-sheet left-page">
            <canvas bind:this={leftCanvas}></canvas>

            <div class="page-edge left-edge"></div>
          </div>
        {/if}

        <div
          class:single-page={mobile}
          class:right-page={!mobile}
          class="page-sheet"
        >
          <canvas bind:this={rightCanvas}></canvas>

          <div class="page-edge"></div>
        </div>

        {#if flipDirection && flipProgress > 0}
          <div
            class:next={flipDirection === "next"}
            class:previous={flipDirection === "previous"}
            class="turning-page"
            style={`--progress:${flipProgress}; --shadow:${flipShadow};`}
          >
            <!-- FRONT -->
            <div class="turn-face front">
              <canvas bind:this={turnFrontCanvas}></canvas>

              <div class="paper-light"></div>

              <div class="paper-shadow"></div>
            </div>

            <!-- BACK -->
            <div class="turn-face back">
              <canvas bind:this={turnBackCanvas}></canvas>

              <div class="back-light"></div>
            </div>
          </div>
        {/if}
      </div>

      {#if loading}
        <div
          class="absolute inset-0 z-40 flex items-center justify-center bg-black/10"
        >
          <div
            class="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-xs text-slate-300 backdrop-blur"
          >
            Memuat halaman...
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .book-stage {
    width: min(92vw, 1320px);
    height: min(78vh, 880px);
    perspective: 2400px;
  }

  .book-spread {
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    transform-style: preserve-3d;

    filter: drop-shadow(0 30px 45px rgba(0, 0, 0, 0.35));
  }

  .page-sheet {
    position: relative;

    overflow: hidden;

    background: white;

    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.28),
      inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }

  .desktop .page-sheet {
    width: min(42vw, 600px);
    max-height: 72vh;

    aspect-ratio: 0.7071;
  }

  .single-page {
    width: min(82vw, 680px);
    max-height: 72vh;

    aspect-ratio: 0.7071;
  }

  canvas {
    display: block;

    width: 100%;
    height: 100%;

    object-fit: contain;

    background: white;
  }

  .left-page {
    transform-origin: right center;

    border-radius: 2px 0 0 2px;
  }

  .right-page {
    transform-origin: left center;

    border-radius: 0 2px 2px 0;
  }

  .single-page {
    border-radius: 3px;
  }

  .page-edge {
    pointer-events: none;

    position: absolute;
    inset: 0;

    box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.08);
  }

  .left-edge {
    box-shadow: inset -14px 0 22px rgba(0, 0, 0, 0.08);
  }

  .book-shadow {
    position: absolute;

    width: 84%;
    height: 14%;

    bottom: -4%;

    border-radius: 50%;

    background: rgba(0, 0, 0, 0.58);

    filter: blur(28px);

    transform: translateZ(-30px);
  }

  /*
   * ============================================
   * TURNING PAGE
   * ============================================
   */

  .turning-page {
    position: absolute;

    top: 0;
    bottom: 0;

    width: 50%;

    z-index: 20;

    transform-style: preserve-3d;

    will-change: transform, filter;

    pointer-events: none;
  }

  /*
   * NEXT
   *
   * Halaman kanan bergerak:
   *
   *       0°
   *        |
   *        |
   *        ↓
   *      180°
   *
   * Pivot berada di kiri.
   */
  .turning-page.next {
    right: 0;

    transform-origin: left center;

    transform: translateZ(8px) rotateY(calc(-180deg * var(--progress)));
  }

  /*
   * PREVIOUS
   *
   * Halaman kiri bergerak ke kanan.
   *
   * Pivot berada di kanan.
   */
  .turning-page.previous {
    left: 0;

    transform-origin: right center;

    transform: translateZ(8px) rotateY(calc(180deg * var(--progress)));
  }

  .turn-face {
    position: absolute;

    inset: 0;

    overflow: hidden;

    background: white;

    backface-visibility: hidden;

    transform-style: preserve-3d;

    box-shadow: 0 0 calc(12px + 22px * var(--shadow)) rgba(0, 0, 0, 0.28);
  }

  /*
   * Sisi belakang harus diputar 180°.
   *
   * Ketika halaman sudah melewati 90°,
   * sisi ini menjadi terlihat.
   */
  .turn-face.back {
    transform: rotateY(180deg);
  }

  .paper-light,
  .paper-shadow,
  .back-light {
    pointer-events: none;

    position: absolute;

    inset: 0;
  }

  /*
   * Highlight pada permukaan kertas.
   */
  .paper-light {
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.03) 32%,
      rgba(255, 255, 255, 0.32) 50%,
      rgba(255, 255, 255, 0.04) 68%,
      transparent 100%
    );

    opacity: calc(var(--shadow) * 0.9);

    mix-blend-mode: screen;
  }

  /*
   * Shadow pada halaman yang sedang melipat.
   */
  .paper-shadow {
    background: linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.28),
      transparent 28%,
      transparent 72%,
      rgba(0, 0, 0, 0.12)
    );

    opacity: calc(0.12 + var(--shadow) * 0.65);
  }

  /*
   * Sedikit shading pada sisi belakang
   * supaya tidak terlihat seperti canvas datar.
   */
  .back-light {
    background: linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.13),
      transparent 30%,
      rgba(255, 255, 255, 0.14) 52%,
      transparent 72%,
      rgba(0, 0, 0, 0.08)
    );

    opacity: calc(0.35 + var(--shadow) * 0.45);
  }

  /*
   * Mobile:
   * halaman memenuhi hampir seluruh stage.
   */
  @media (max-width: 767px) {
    .book-stage {
      width: 94vw;
      height: 72vh;
    }

    .single-page {
      width: min(88vw, 560px);
      max-height: 70vh;
    }

    .turning-page {
      width: 100%;
    }
  }
</style>
