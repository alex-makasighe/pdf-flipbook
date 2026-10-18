<script lang="ts">
  import FlipBook from "./FlipBook.svelte";
  import ThumbnailPanel from "./ThumbnailPanel.svelte";
  import ViewerToolbar from "./ViewerToolbar.svelte";
  import type { PdfService } from "../services/PdfService";

  //   import type { Component } from "svelte";
  //   const checkComponent: Component<{
  //   pageCount: number;
  //   currentPage: number;
  //   pdfService: PdfService | null;
  //   onSelect: (page: number) => void;
  // }> = ThumbnailPanel;

  type Props = {
    pdfUrl: string;
    title: string;
    pageCount: number;
  };

  let { pdfUrl, title, pageCount: initialPageCount }: Props = $props();

  let page = $state(1);
  let pageCount = $state(initialPageCount);
  let zoom = $state(1);
  let pdfService = $state<PdfService | null>(null);

  let viewerRoot: HTMLDivElement | null = null;

  function previous(): void {
    const step = window.innerWidth < 768 ? 1 : 2;

    page = Math.max(1, page - step);
  }

  function next(): void {
    const step = window.innerWidth < 768 ? 1 : 2;

    page = Math.min(pageCount, page + step);
  }

  function zoomIn(): void {
    zoom = Math.min(1.5, Number((zoom + 0.1).toFixed(2)));
  }

  function zoomOut(): void {
    zoom = Math.max(0.75, Number((zoom - 0.1).toFixed(2)));
  }

  function fit(): void {
    zoom = 1;
  }

  async function fullscreen(): Promise<void> {
    if (!viewerRoot) {
      return;
    }

    if (document.fullscreenElement === null) {
      await viewerRoot.requestFullscreen();
      return;
    }

    await document.exitFullscreen();
  }

  function handleSelectPage(selected: number): void {
    page = selected;
  }

  function handlePageChange(selected: number): void {
    page = selected;
  }

  function handlePageCount(count: number): void {
    pageCount = count;

    if (page > count) {
      page = Math.max(1, count);
    }
  }

  function handlePdfReady(service: PdfService): void {
    pdfService = service;
  }
</script>

<svelte:head>
  <title>{title} — PDF Flipbook</title>
  <meta name="description" content={`Membaca ${title} sebagai flipbook.`} />
</svelte:head>

<div
  bind:this={viewerRoot}
  class="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#080b12]"
>
  <header
    class="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0b0f17]/90 px-3 backdrop-blur-xl sm:px-5"
  >
    <a
      href="/"
      class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
      aria-label="Kembali"
    >
      ‹
    </a>

    <div class="min-w-0 flex-1">
      <h1 class="truncate text-sm font-semibold text-slate-200">
        {title}
      </h1>

      <p class="text-[10px] uppercase tracking-[0.16em] text-slate-600">
        PDF Flipbook
      </p>
    </div>
  </header>

  <main class="relative min-h-0 flex-1">
    <ThumbnailPanel
      {pageCount}
      currentPage={page}
      {pdfService}
      onSelect={handleSelectPage}
    />

    <FlipBook
      {pdfUrl}
      {page}
      {zoom}
      onPageChange={handlePageChange}
      onPageCount={handlePageCount}
      onPdfReady={handlePdfReady}
    />
  </main>

  <ViewerToolbar
    {page}
    {pageCount}
    {zoom}
    onPrevious={previous}
    onNext={next}
    onZoomIn={zoomIn}
    onZoomOut={zoomOut}
    onFit={fit}
    onFullscreen={() => void fullscreen()}
  />
</div>
