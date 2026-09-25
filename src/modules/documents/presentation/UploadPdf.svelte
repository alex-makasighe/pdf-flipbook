<script lang="ts">
  let input: HTMLInputElement;
  let uploading = $state(false);
  let error = $state("");
  let progress = $state(0);

  const dispatch = (event: "uploaded") => {
    window.dispatchEvent(new CustomEvent(event));
  };

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    error = "";
    uploading = true;
    progress = 15;

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/documents", {
        method: "POST",
        body: form
      });

      progress = 80;

      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Upload gagal.");

      progress = 100;
      dispatch("uploaded");
      if (input) input.value = "";
    } catch (err) {
      error = err instanceof Error ? err.message : "Upload gagal.";
    } finally {
      uploading = false;
      setTimeout(() => (progress = 0), 500);
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    void handleFiles(event.dataTransfer?.files ?? null);
  }
</script>

<div
  class="rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/20"
  ondragover={(event) => event.preventDefault()}
  ondrop={onDrop}
>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h2 class="text-sm font-semibold text-white">Upload PDF</h2>
      <p class="mt-1 text-xs text-slate-400">Maksimal 100 MB per file.</p>
    </div>
    <span class="rounded-full bg-white/5 px-3 py-1 text-[11px] text-slate-400">PDF</span>
  </div>

  <label
    class="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/10 px-6 py-10 text-center transition hover:border-cyan-400/40 hover:bg-cyan-400/[0.03]"
  >
    <input
      bind:this={input}
      class="hidden"
      type="file"
      accept="application/pdf,.pdf"
      onchange={(event) => void handleFiles((event.currentTarget as HTMLInputElement).files)}
      disabled={uploading}
    />

    <div class="mb-3 rounded-full bg-cyan-400/10 p-3 text-cyan-300">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 16V4m0 0 4 4m-4-4L8 8M5 20h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <span class="text-sm font-medium text-slate-200">
      {uploading ? "Mengupload..." : "Pilih PDF atau drag & drop di sini"}
    </span>
    <span class="mt-1 text-xs text-slate-500">PDF saja</span>
  </label>

  {#if progress > 0}
    <div class="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
      <div class="h-full rounded-full bg-cyan-400 transition-all" style={`width:${progress}%`}></div>
    </div>
  {/if}

  {#if error}
    <p class="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">
      {error}
    </p>
  {/if}
</div>
