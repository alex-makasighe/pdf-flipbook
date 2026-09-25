import { json } from "@sveltejs/kit";
import { DocumentService } from "$modules/documents/services/DocumentService";

const service = new DocumentService();

export async function GET({ params, request }): Promise<Response> {
  const response = await service.getPdfResponse(
    params.id,
    request.headers.get("range")
  );

  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function DELETE({ params }): Promise<Response> {
  const document = await service.get(params.id);

  if (!document) {
    return json({ message: "Dokumen tidak ditemukan." }, { status: 404 });
  }

  await service.delete(params.id);
  return json({ success: true });
}
