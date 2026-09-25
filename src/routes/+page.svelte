<script lang="ts">
  import UploadPdf from "$modules/documents/presentation/UploadPdf.svelte";
  import DocumentList from "$modules/documents/presentation/DocumentList.svelte";
</script>

<svelte:head>
  <title>PDF Flipbook</title>
  <meta
    name="description"
    content="Upload PDF dan baca dengan pengalaman flipbook interaktif."
  />
</svelte:head>

<div class="min-h-dvh">
  <header class="border-b border-white/10 bg-[#0b0f17]/80 backdrop-blur-xl">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
      <div>
        <div class="text-sm font-black tracking-tight text-white">PDF<span class="text-cyan-400">Flip</span></div>
        <div class="text-[9px] uppercase tracking-[0.25em] text-slate-600">Document viewer</div>
      </div>
      <div class="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-500">
        SvelteKit · PDF.js
      </div>
    </div>
  </header>

  <main class="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[360px_1fr]">
    <UploadPdf />
    <DocumentList />
  </main>
</div>
