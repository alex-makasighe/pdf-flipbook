<script lang="ts">
  interface Props {
    page: number;
    pageCount: number;
    zoom: number;
    onPrevious: () => void;
    onNext: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onFullscreen: () => void;
  }

  let {
    page,
    pageCount,
    zoom,
    onPrevious,
    onNext,
    onZoomIn,
    onZoomOut,
    onFit,
    onFullscreen
  }: Props = $props();
</script>

<div class="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0d111a]/95 px-3 py-2.5 backdrop-blur-xl">
  <div class="flex items-center gap-1">
    <button class="toolbar-button" title="Halaman sebelumnya" onclick={onPrevious} disabled={page <= 1}>‹</button>
    <span class="min-w-[74px] text-center text-xs text-slate-400">{page} / {pageCount}</span>
    <button class="toolbar-button" title="Halaman berikutnya" onclick={onNext} disabled={page >= pageCount}>›</button>
  </div>

  <div class="hidden items-center gap-1 sm:flex">
    <button class="toolbar-button" title="Zoom out" onclick={onZoomOut}>−</button>
    <button class="toolbar-button min-w-[64px] text-[11px]" title="Fit" onclick={onFit}>
      {Math.round(zoom * 100)}%
    </button>
    <button class="toolbar-button" title="Zoom in" onclick={onZoomIn}>+</button>
  </div>

  <button class="toolbar-button" title="Fullscreen" onclick={onFullscreen}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 0v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
  </button>
</div>

<style>
  .toolbar-button {
    display: inline-flex;
    height: 32px;
    min-width: 32px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #94a3b8;
    transition: background .15s, color .15s;
  }
  .toolbar-button:hover:not(:disabled) {
    background: rgba(255,255,255,.07);
    color: white;
  }
  .toolbar-button:disabled {
    cursor: not-allowed;
    opacity: .3;
  }
</style>
