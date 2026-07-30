import { NextResponse } from "next/server";
import { previewSoftwareImport } from "@/lib/administration/logiciels/importer.ts";
import { parseSoftwareImportSourceFormData } from "@/lib/administration/logiciels/validation.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const source = parseSoftwareImportSourceFormData(await request.formData());
    const preview = await previewSoftwareImport(
      source.source === "local_catalogue"
        ? { kind: "local_catalogue" }
        : {
            kind: "uploaded_file",
            fileName: source.file.name,
            buffer: Buffer.from(await source.file.arrayBuffer())
          }
    );

    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Previsualisation impossible." },
      { status: 400 }
    );
  }
}
