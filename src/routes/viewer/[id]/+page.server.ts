import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { DocumentService } from "$modules/documents/services/DocumentService";

const service = new DocumentService();

export const load: PageServerLoad = async ({ params }) => {
  const document = await service.get(params.id);

  if (!document) {
    throw error(404, "Dokumen tidak ditemukan.");
  }

  return {
    document
  };
};
