import { NextResponse } from "next/server";
import { confirmSoftwareAnalysisImport } from "@/lib/appels-offres/software-analysis-importer.ts";
import type { SoftwareAnalysisImportSource } from "@/lib/appels-offres/software-analysis-types.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

function parseImportSource(formData: FormData): Promise<SoftwareAnalysisImportSource> | SoftwareAnalysisImportSource {
  const source = typeof formData.get("source") === "string" ? formData.get("source") : "";
  const file = formData.get("file");

  if (source === "local_example") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("L'exemple local est reserve au developpement.");
    }

    return {
      kind: "local_example"
    };
  }

  if (!(file instanceof File)) {
    throw new Error("Selectionnez un fichier Excel .xlsx.");
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Seuls les fichiers Excel .xlsx sont acceptes pour cette analyse.");
  }

  return file.arrayBuffer().then((buffer) => ({
    kind: "uploaded_file",
    fileName: file.name,
    buffer: Buffer.from(buffer)
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse) {
      return deniedResponse;
    }

    const { code } = await params;
    const source = await parseImportSource(await request.formData());
    const summary = await confirmSoftwareAnalysisImport(code, source);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import impossible." },
      { status: 400 }
    );
  }
}
