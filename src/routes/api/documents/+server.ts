import { json } from "@sveltejs/kit";
import { DocumentService } from "$modules/documents/services/DocumentService";

const service = new DocumentService();

export async function GET(): Promise<Response> {
  return json(await service.list());
}

export async function POST({ request }): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json({ message: "File PDF wajib diisi." }, { status: 400 });
    }

    const document = await service.upload(file);
    return json({ document }, { status: 201 });
  } catch (err) {
    return json(
      { message: err instanceof Error ? err.message : "Upload gagal." },
      { status: 400 }
    );
  }
}
