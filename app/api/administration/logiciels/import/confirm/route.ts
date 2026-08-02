import { NextResponse } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { confirmSoftwareImport } from "@/lib/administration/logiciels/importer.ts";
import { parseSoftwareImportSourceFormData } from "@/lib/administration/logiciels/validation.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { deniedResponse } = await requireAreaAccessForRequest(request, "administration");
    if (deniedResponse) {
      return deniedResponse;
    }

    const source = parseSoftwareImportSourceFormData(await request.formData());
    const summary = await confirmSoftwareImport(
      source.source === "local_catalogue"
        ? { kind: "local_catalogue" }
        : {
            kind: "uploaded_file",
            fileName: source.file.name,
            buffer: Buffer.from(await source.file.arrayBuffer())
          }
    );

    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import impossible." },
      { status: 400 }
    );
  }
}
