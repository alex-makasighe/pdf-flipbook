<script lang="ts">
  import { onDestroy, tick } from "svelte";
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

  // Hindari render ulang setelah commitFlip menyiapkan canvas tujuan.
  let skipNextPageRender = false;

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

  /*
   * Digunakan supaya halaman depan tidak perlu
   * dirender ulang hanya untuk memulai gesture.
   */
  let preparedDirection = $state<FlipDirection | null>(null);

  let preparingTurn = false;
  let coverOpening = $state(false);

  function updateMobile(): void {
    mobile = window.matchMedia("(max-width: 767px)").matches;
  }

  function spreadStart(current: number): number {
    if (mobile || isCoverPage(current)) {
      return current;
    }

    return current % 2 === 0 ? current : Math.max(1, current - 1);
  }

  function spreadEnd(current: number): number {
    if (mobile || isCoverPage(current)) {
      return current;
    }

    return current % 2 === 1 ? current : current + 1;
  }

  // Sampul depan dan belakang tampil sebagai satu halaman di tengah.
  function isCoverPage(current: number): boolean {
    return (
      !mobile &&
      (current === 1 ||
        (pdfService.numPages > 0 && current === pdfService.numPages))
    );
  }

  function calculateScale(): number {
    const width = host?.clientWidth ?? 1000;

    const targetWidth = mobile ? width * 0.82 : width * 0.39;

    return Math.min(1.6, Math.max(0.65, targetWidth / 700)) * zoom;
  }

  async function renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement | null,
    scale: number,
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

  function clearCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }

  async function renderCurrent(): Promise<void> {
    if (!pdfService.isLoaded) {
      return;
    }

    loading = true;
    error = "";

    try {
      const scale = calculateScale();

      if (mobile || isCoverPage(page)) {
        await renderPage(page, rightCanvas, scale);
        if (!mobile && leftCanvas) {
          clearCanvas(leftCanvas);
        }
      } else {
        const left = spreadStart(page);
        const right = spreadEnd(page);

        await renderPage(left, leftCanvas, scale);
        await renderPage(right, rightCanvas, scale);
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
    flipDirection = null;
    preparedDirection = null;
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
    target: HTMLCanvasElement | null,
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
      const frontCanvas =
        mobile || isCoverPage(page)
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
      // Saat membuka sampul depan, sisi belakang sampul adalah halaman 2,
      // sementara spread yang terbuka akan berisi halaman 2 dan 3.
      const openingFrontCover = !mobile && page === 1 && direction === "next";
      const openingBackCover =
        !mobile && page === pdfService.numPages && direction === "previous";

      // Sisi dalam sampul berisi halaman yang menempel pada sampul:
      // halaman 2 saat membuka sampul depan, atau halaman N-1 saat
      // membuka sampul belakang.
      const backPage = openingFrontCover
        ? Math.max(1, target - 1)
        : openingBackCover
          ? Math.min(pdfService.numPages, target + 1)
          : target;

      await renderPage(backPage, turnBackCanvas, calculateScale());

      preparedDirection = direction;
    } finally {
      preparingTurn = false;
    }
  }

  /*
   * Ease-out untuk animasi ketika gesture dilepas.
   */
  // Smoothstep quintic: akselerasi dan deselerasi lebih lembut,
  // tanpa perubahan kecepatan yang terasa mendadak di awal/akhir.
  function easeInOutQuint(value: number): number {
    return value < 0.5
      ? 16 * value * value * value * value * value
      : 1 - Math.pow(-2 * value + 2, 5) / 2;
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

        const eased = easeInOutQuint(t);

        flipProgress = start + delta * eased;

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
    if (flipping || !pdfService.isLoaded) return;

    const target =
      direction === "next"
        ? flipService.next(page, pdfService.numPages, mobile)
        : flipService.previous(page, pdfService.numPages, mobile);

    if (target === page) {
      resetFlip();
      return;
    }

    // Kedua sampul memakai gerakan fisik yang sama: sampul berputar
    // dari punggung buku dan spread tujuan sudah terlihat di bawahnya.
    const openingCover =
      !mobile &&
      ((page === 1 && direction === "next") ||
        (page === pdfService.numPages && direction === "previous"));
    const scale = calculateScale();
    flipping = true;
    error = "";

    try {
      // Salin sampul ke layer animasi terlebih dahulu. Saat membuka sampul,
      // siapkan spread halaman 2–3 di belakangnya sebelum animasi dimulai.
      await prepareTurn(direction);

      if (preparedDirection !== direction) {
        await prepareTurn(direction);
      }

      if (openingCover) {
        coverOpening = true;
        await tick();
        const targetLeft = spreadStart(target);
        const targetRight = spreadEnd(target);
        await renderPage(targetLeft, leftCanvas, scale);
        await renderPage(targetRight, rightCanvas, scale);
      }

      // Baru tampilkan layer flip setelah canvas depan/belakang dan spread
      // di bawahnya siap, supaya tidak ada frame kosong atau loncatan awal.
      flipDirection = direction;
      flipProgress = 0;
      await tick();
      // Pembukaan sampul depan dan belakang dibuat lebih lambat agar transisi
      // dari satu halaman ke spread dua halaman terasa bertahap dan natural.
      // Kedua arah memakai durasi yang sama supaya gerakannya konsisten.
      await animateTo(1, openingCover ? 1550 : 920);

      if (mobile || isCoverPage(target)) {
        await renderPage(target, rightCanvas, scale);
        if (!mobile && leftCanvas) clearCanvas(leftCanvas);
      } else {
        const targetLeft = spreadStart(target);
        const targetRight = spreadEnd(target);
        await renderPage(targetLeft, leftCanvas, scale);
        await renderPage(targetRight, rightCanvas, scale);
      }

      skipNextPageRender = true;
      onPageChange(target);
      await tick();

      resetFlip();
      coverOpening = false;
      flipping = false;
      void preloadAround(target, scale);
    } catch (err) {
      resetFlip();
      coverOpening = false;
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

    await animateTo(0, 420);

    resetFlip();
  }

  function onBookClick(event: MouseEvent): void {
    if (flipping || loading || !pdfService.isLoaded) {
      return;
    }

    const spread =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelector(".book-spread")
        : null;

    if (!(spread instanceof HTMLElement)) {
      return;
    }

    // Pada sampul (halaman tunggal), spread masih selebar area buku.
    // Gunakan posisi halaman yang benar agar klik sebelumnya tidak jatuh
    // pada area kosong di sisi kiri/kanan spread.
    if (mobile || isCoverPage(page)) {
      const sheet = spread.querySelector(".page-sheet");
      if (!(sheet instanceof HTMLElement)) return;

      const pageRect = sheet.getBoundingClientRect();
      const x = event.clientX - pageRect.left;

      if (x < 0 || x > pageRect.width) return;

      if (x <= pageRect.width * 0.35) {
        void commitFlip("previous");
      } else if (x >= pageRect.width * 0.65) {
        void commitFlip("next");
      }
      return;
    }

    const rect = spread.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const edgeWidth = Math.min(100, rect.width * 0.18);

    // Pada spread normal, klik hanya bekerja pada tepi luar buku.
    if (x <= edgeWidth) {
      void commitFlip("previous");
    } else if (x >= rect.width - edgeWidth) {
      void commitFlip("next");
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

    if (skipNextPageRender) {
      skipNextPageRender = false;
      return;
    }

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
  class="relative flex h-full min-h-0 w-full select-none items-center justify-center overflow-hidden"
  onclick={onBookClick}
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

      <div class="book-card">
        <div class="book-card-glow"></div>
        <div class="book-spread-shell">
          <div
            class:single={mobile || (isCoverPage(page) && !coverOpening)}
            class:opening-cover={coverOpening}
            class="book-spread"
          >
            {#if !mobile && (coverOpening || (page !== 1 && !isCoverPage(page)))}
              <div class="page-sheet left-page">
                <canvas bind:this={leftCanvas}></canvas>

                <div class="page-edge left-edge"></div>
              </div>
            {/if}

            <div
              class:single-page={mobile || (isCoverPage(page) && !coverOpening)}
              class:right-page={!mobile && (!isCoverPage(page) || coverOpening)}
              class="page-sheet"
            >
              <canvas bind:this={rightCanvas}></canvas>

              <div class="page-edge"></div>
            </div>

            <div
              class:next={flipDirection === "next"}
              class:previous={flipDirection === "previous"}
              class:single-turn={mobile || (isCoverPage(page) && !coverOpening)}
              class:cover-turn={coverOpening &&
                !(page === pdfService.numPages && flipDirection === "previous")}
              class:back-cover-turn={coverOpening &&
                page === pdfService.numPages &&
                flipDirection === "previous"}
              class:inactive={!flipDirection ||
                flipProgress <= 0 ||
                coverOpening}
              class="turning-page"
              style={`--progress:${flipProgress}; --flip-shadow:${Math.sin(flipProgress * Math.PI)};`}
            >
              <!-- FRONT -->
              <div class="turn-face front">
                <canvas bind:this={turnFrontCanvas}></canvas>
              </div>

              <!-- BACK -->
              <div class="turn-face back">
                <canvas bind:this={turnBackCanvas}></canvas>
              </div>
            </div>
          </div>
        </div>
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
  /* =========================================================
     VIEWER: memenuhi area parent dan menjaga buku tetap center
  ========================================================= */

  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    min-width: 0;
  }

  .book-stage {
    position: relative;
    isolation: isolate;
    container-type: size;
    perspective: 2600px;
    width: min(100%, 1760px);
    height: min(100%, 1180px);
    min-width: 0;
    min-height: 0;
    margin-inline: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* =========================================================
     CARD: ruang halaman tidak terbuang oleh padding besar
  ========================================================= */

  .book-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: clamp(4px, 0.8vw, 14px);
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: clamp(10px, 1.2vw, 22px);
    background: linear-gradient(
      145deg,
      rgba(30, 41, 59, 0.96),
      rgba(9, 14, 25, 0.98) 58%,
      rgba(17, 24, 39, 0.98)
    );
    box-shadow:
      0 28px 80px rgba(0, 0, 0, 0.48),
      0 8px 24px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.09),
      inset 0 0 0 5px rgba(255, 255, 255, 0.018);
  }

  .book-card::before {
    content: "";
    position: absolute;
    inset: 6px;
    border: 1px solid rgba(255, 255, 255, 0.045);
    border-radius: 12px;
    pointer-events: none;
  }

  .book-card-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(
      ellipse at 50% 42%,
      rgba(148, 163, 184, 0.12),
      transparent 62%
    );
    pointer-events: none;
  }

  /* =========================================================
     SPREAD: dua halaman desktop selalu di tengah card
  ========================================================= */

  .book-spread-shell {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    box-sizing: border-box;
    transform-style: preserve-3d;
  }

  .book-spread {
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: center;
    flex: 0 1 auto;
    width: min(100%, calc((100cqh - 36px) * 1.4142));
    aspect-ratio: 1.4142;
    max-width: 100%;
    max-height: 100%;
    min-width: 0;
    min-height: 0;
    margin: auto;
    cursor: default;
    transform-style: preserve-3d;
    filter: drop-shadow(0 16px 18px rgba(0, 0, 0, 0.3));
    /* Animasi ini hanya menghaluskan perubahan tata letak sampul tunggal
       menjadi spread dua halaman; transform animasi flip tidak diubah. */
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      height 760ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* =========================================================
     PAGE: setiap halaman mengikuti setengah spread
  ========================================================= */

  .page-sheet {
    position: relative;
    flex: 0 1 50%;
    width: 50%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    aspect-ratio: 0.7071;
    overflow: hidden;
    background: #fff;
    cursor: pointer;
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.16),
      inset 0 0 0 1px rgba(15, 23, 42, 0.08),
      inset 0 0 20px rgba(15, 23, 42, 0.035);
    /* Perubahan ukuran/posisi lembar saat layout cover -> spread. */
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 760ms cubic-bezier(0.22, 1, 0.36, 1),
      border-radius 760ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .desktop .page-sheet {
    flex: 0 1 50%;
    width: 50%;
    max-width: 50%;
    height: 100%;
    max-height: 100%;
  }

  /* Paksa canvas mengikuti kotak halaman.
     Ukuran bitmap internal tetap dikelola oleh PdfService. */

  .page-sheet canvas,
  .turn-face canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #fff;
  }

  .left-page {
    z-index: 1;
    transform-origin: right center;
    border-radius: 3px 0 0 3px;
    box-shadow:
      inset -12px 0 18px rgba(15, 23, 42, 0.11),
      inset 0 0 0 1px rgba(15, 23, 42, 0.1),
      -2px 3px 7px rgba(0, 0, 0, 0.16);
  }

  .right-page {
    z-index: 1;
    transform-origin: left center;
    border-radius: 0 3px 3px 0;
    box-shadow:
      inset 12px 0 18px rgba(15, 23, 42, 0.12),
      inset 0 0 0 1px rgba(15, 23, 42, 0.1),
      2px 3px 7px rgba(0, 0, 0, 0.16);
  }

  /* Halaman kiri muncul dari punggung buku saat spread mulai terbuka.
     Ini hanya animasi layout, bukan animasi membalik halaman. */
  .book-spread.opening-cover .left-page {
    transform-origin: right center;
    animation: reveal-left-page 760ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes reveal-left-page {
    from {
      clip-path: inset(0 0 0 100%);
      opacity: 0.82;
    }
    to {
      clip-path: inset(0 0 0 0);
      opacity: 1;
    }
  }

  /* =========================================================
     SINGLE PAGE: mobile dan tampilan satu halaman
  ========================================================= */

  .book-spread.single {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Keep the spread frame constrained to the same book-card bounds
       before, during, and after the cover-to-spread transition. */
    width: min(100%, calc((100cqh - 36px) * 1.4142));
    height: auto;
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 1.4142;
    box-sizing: border-box;
  }

  .single-page {
    flex: 0 1 auto;
    width: min(100%, calc((100cqh - 36px) * 0.7071));
    height: auto;
    max-width: 100%;
    max-height: 100%;
    aspect-ratio: 0.7071;
    border-radius: 3px;
    transition:
      width 760ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 760ms cubic-bezier(0.22, 1, 0.36, 1),
      border-radius 760ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow:
      0 0 0 1px rgba(15, 23, 42, 0.15),
      5px 8px 18px rgba(0, 0, 0, 0.22),
      inset 0 0 0 1px rgba(15, 23, 42, 0.07);
  }

  /* =========================================================
     DETAIL VISUAL BUKU
  ========================================================= */

  .book-spread:not(.single)::after {
    content: "";
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    left: 50%;
    width: clamp(8px, 1vw, 18px);
    transform: translateX(-50%);
    pointer-events: none;
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.2),
      rgba(15, 23, 42, 0.04) 28%,
      rgba(255, 255, 255, 0.2) 50%,
      rgba(15, 23, 42, 0.1) 72%,
      rgba(15, 23, 42, 0.2)
    );
  }

  .page-edge {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 24px rgba(15, 23, 42, 0.075);
  }

  .left-edge {
    box-shadow: inset -16px 0 24px rgba(15, 23, 42, 0.14);
  }

  .book-shadow {
    position: absolute;
    width: 88%;
    height: 13%;
    bottom: -5%;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.72);
    filter: blur(30px);
    transform: translateZ(-35px);
    pointer-events: none;
  }

  /* =========================================================
     PAGE FLIP ANIMATION
  ========================================================= */

  .turning-page {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    z-index: 20;
    overflow: visible;
    transform-style: preserve-3d;
    will-change: transform;
    pointer-events: none;
    backface-visibility: visible;
  }

  .turning-page.inactive {
    visibility: hidden;
  }

  .turning-page.single-turn {
    width: 100%;
    left: 0;
    right: 0;
  }

  .turning-page.single-turn.next {
    left: auto;
    right: 0;
    width: 100%;
    transform-origin: right center;
  }

  .turning-page.single-turn.previous {
    left: 0;
    right: auto;
    width: 100%;
    transform-origin: left center;
  }

  .turning-page.next {
    right: 0;
    transform-origin: left center;
    transform: translateZ(12px) rotateY(calc(-180deg * var(--progress)));
  }

  .turning-page.previous {
    left: 0;
    transform-origin: right center;
    transform: translateZ(12px) rotateY(calc(180deg * var(--progress)));
  }

  /* Sampul depan berputar dari punggung buku, seperti membuka cover fisik. */
  .book-spread:not(.single) .turning-page.next {
    right: 0;
    width: 50%;
    transform-origin: left center;
    transform: translateZ(14px) rotateY(calc(-180deg * var(--progress)));
  }

  /*
   * Sampul belakang dibuka dengan mekanika yang sama seperti sampul depan.
   * Walaupun aksi navigasinya "previous", sampul tetap berada di sisi kanan
   * spread dan berputar dari punggung buku. Ini mencegah animasi menyapu
   * halaman kiri atau terlihat seperti membalik halaman biasa.
   */
  .book-spread:not(.single) .turning-page.cover-turn {
    left: auto;
    right: 0;
    width: 50%;
    transform-origin: left center;
    transform: translateZ(14px) rotateY(calc(-180deg * var(--progress)));
  }

  /*
   * Sampul belakang bergerak dengan arah kebalikan dari sampul depan.
   * Saat pengguna kembali dari halaman terakhir, sampul berada di sisi kiri
   * dan berputar dari punggung kanan ke arah kiri-ke-kanan, membuka spread
   * halaman sebelumnya di bawahnya.
   */
  .book-spread:not(.single) .turning-page.back-cover-turn {
    left: 0;
    right: auto;
    width: 50%;
    transform-origin: right center;
    transform: translateZ(14px) rotateY(calc(180deg * var(--progress)));
  }

  .turn-face {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #fff;
    backface-visibility: hidden;
    transform-style: preserve-3d;
    box-shadow:
      0 0 10px rgba(0, 0, 0, 0.16),
      inset 0 0 0 1px rgba(15, 23, 42, 0.1);
  }

  /* Bayangan bergerak mengikuti lipatan, bukan hanya menempel statis. */
  .turn-face::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: calc(var(--flip-shadow, 0) * 0.72);
    transition: none;
  }

  .turn-face.front::after {
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.02) 0%,
      rgba(15, 23, 42, 0.03) 48%,
      rgba(15, 23, 42, 0.42) 100%
    );
  }

  .turn-face.back::after {
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.36) 0%,
      rgba(15, 23, 42, 0.08) 34%,
      rgba(255, 255, 255, 0.02) 100%
    );
  }

  .turn-face.front {
    border-radius: 2px 0 0 2px;
  }

  .turn-face.back {
    transform: rotateY(180deg);
    border-radius: 0 2px 2px 0;
    box-shadow:
      inset 0 0 18px rgba(15, 23, 42, 0.1),
      0 0 8px rgba(0, 0, 0, 0.12);
  }

  /* =========================================================
     TABLET DAN MOBILE
  ========================================================= */

  @media (max-width: 767px) {
    .book-stage {
      width: 100%;
      height: min(82dvh, 900px);
    }

    .book-card {
      padding: 4px;
      border-radius: 12px;
    }

    .book-card::before {
      inset: 4px;
      border-radius: 9px;
    }

    .book-spread-shell {
      padding: 0;
    }

    .book-spread.single {
      width: 100%;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      aspect-ratio: 1.4142;
    }

    .single-page {
      width: min(100%, calc((100cqh - 24px) * 0.7071));
      height: auto;
      max-height: calc(100cqh - 24px);
    }

    .turning-page {
      width: 100%;
    }

    .book-spread:not(.single)::after {
      width: 10px;
    }
  }

  /* =========================================================
     LAYAR PENDEK / LANDSCAPE
  ========================================================= */

  @media (max-height: 560px) {
    .book-stage {
      height: 92dvh;
    }

    .book-card {
      padding: 4px;
    }

    .book-spread {
      width: min(100%, calc((92dvh - 20px) * 1.4142));
    }

    .single-page {
      width: min(100%, calc((92dvh - 20px) * 0.7071));
      max-height: calc(92dvh - 20px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .turning-page,
    .turn-face,
    .book-spread,
    .page-sheet,
    .single-page {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
