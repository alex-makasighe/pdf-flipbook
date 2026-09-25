<script lang="ts">
  import type { PdfService } from "../services/PdfService";

  interface Props {
    pageCount: number;
    currentPage: number;
    pdfService: PdfService | null;
    onSelect: (page: number) => void;
  }

  let { pageCount, currentPage, pdfService, onSelect }: Props = $props();

  let visible = $state(true);
  let thumbs = $state<Record<number, string>>({});
  let loading = new Set<number>();

  async function renderThumbnail(page: number): Promise<void> {
    if (!pdfService || thumbs[page] || loading.has(page)) return;

    loading.add(page);

    try {
      thumbs[page] = await pdfService.renderToDataUrl(page, 0.14);
    } catch {
      // Thumbnail is optional.
    } finally {
      loading.delete(page);
    }
  }

  $effect(() => {
    if (!visible || !pdfService || pageCount <= 0) return;

    const start = Math.max(1, currentPage - 5);
    const end = Math.min(pageCount, currentPage + 8);

    for (let page = start; page <= end; page += 1) {
      void renderThumbnail(page);
    }
  });
</script>

<div class={`absolute inset-y-0 left-0 z-20 flex transition-transform duration-200 ${visible ? "translate-x-0" : "-translate-x-full"}`}>
  <aside class="viewer-scrollbar flex w-[78px] flex-col gap-2 overflow-y-auto border-r border-white/10 bg-[#0b0f17]/96 p-2 shadow-2xl backdrop-blur-xl">
    {#each Array(pageCount) as _, index}
      {@const page = index + 1}

      <button
        type="button"
        class={`overflow-hidden rounded-md border bg-black/20 p-1 transition ${page === currentPage ? "border-cyan-400 shadow-lg shadow-cyan-400/10" : "border-white/10 hover:border-white/25"}`}
        title={`Halaman ${page}`}
        onclick={() => onSelect(page)}
      >
        {#if thumbs[page]}
          <img src={thumbs[page]} alt={`Halaman ${page}`} class="w-full rounded-sm" />
        {:else}
          <div class="aspect-[3/4] animate-pulse rounded bg-white/5"></div>
        {/if}

        <span class="mt-1 block text-[9px] text-slate-500">{page}</span>
      </button>
    {/each}
  </aside>

  <button
    type="button"
    aria-label="Tutup thumbnail"
    class="mt-3 h-8 w-7 rounded-r-lg border border-l-0 border-white/10 bg-[#0b0f17]/95 text-slate-400 shadow-xl"
    onclick={() => (visible = false)}
  >
    ‹
  </button>
</div>

{#if !visible}
  <button
    type="button"
    class="absolute left-0 top-3 z-20 flex h-8 w-7 items-center justify-center rounded-r-lg border border-l-0 border-white/10 bg-[#0b0f17]/95 text-slate-400 shadow-xl"
    onclick={() => (visible = true)}
    aria-label="Buka thumbnail"
  >
    ›
  </button>
{/if}
