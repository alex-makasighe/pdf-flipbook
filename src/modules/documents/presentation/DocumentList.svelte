<script lang="ts">
  import type { DocumentMetadata } from "../types/document.types";

  let documents = $state<DocumentMetadata[]>([]);
  let loading = $state(true);
  let error = $state("");

  async function load(): Promise<void> {
    loading = true;
    error = "";

    try {
      const response = await fetch("/api/documents");
      if (!response.ok) throw new Error("Gagal mengambil daftar dokumen.");
      documents = (await response.json()) as DocumentMetadata[];
    } catch (err) {
      error = err instanceof Error ? err.message : "Gagal mengambil dokumen.";
    } finally {
      loading = false;
    }
  }

  async function remove(document: DocumentMetadata): Promise<void> {
    if (!confirm(`Hapus "${document.originalName}"?`)) return;

    const response = await fetch(`/api/documents/${document.id}`, {
      method: "DELETE"
    });

    if (response.ok) {
      documents = documents.filter((item) => item.id !== document.id);
    }
  }

  function formatSize(size: number): string {
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function refresh(): void {
    void load();
  }

  $effect(() => {
    window.addEventListener("documents:uploaded", refresh);
    void load();

    return () => window.removeEventListener("documents:uploaded", refresh);
  });
</script>

<div class="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-white">Dokumen</h2>
      <p class="mt-1 text-xs text-slate-400">PDF yang tersimpan di local storage.</p>
    </div>
    <span class="rounded-full bg-white/5 px-3 py-1 text-[11px] text-slate-400">{documents.length} file</span>
  </div>

  {#if loading}
    <div class="mt-6 text-sm text-slate-500">Memuat...</div>
  {:else if error}
    <div class="mt-6 text-sm text-red-300">{error}</div>
  {:else if documents.length === 0}
    <div class="mt-6 rounded-xl border border-white/5 bg-black/10 px-5 py-10 text-center text-sm text-slate-500">
      Belum ada PDF.
    </div>
  {:else}
    <div class="mt-5 space-y-2">
      {#each documents as document}
        <div class="flex items-center gap-3 rounded-xl border border-white/5 bg-black/10 p-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-400/10 text-red-300">
            PDF
          </div>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-200">{document.originalName}</p>
            <p class="mt-0.5 text-[11px] text-slate-500">
              {formatSize(document.size)} · {new Date(document.createdAt).toLocaleString("id-ID")}
            </p>
          </div>

          <a
            href={`/viewer/${document.id}`}
            class="rounded-lg bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/20"
          >
            Buka
          </a>

          <button
            type="button"
            class="rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-red-400/10 hover:text-red-300"
            onclick={() => void remove(document)}
          >
            Hapus
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
