<script lang="ts">
  // import PdfViewer from "$modules/viewer/presentation/PdfViewer.svelte";
  import PdfViewer from "../../../modules/viewer/presentation/PdfViewer.svelte";

  interface PageData {
    document: {
      id: string;
      originalName: string;
    };
  }

  let { data }: { data: PageData } = $props();
</script>

<PdfViewer
  pdfUrl={`/api/documents/${data.document.id}`}
  title={data.document.originalName}
  pageCount={0}
/>
