import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getAppelOffresPdfPath } from "@/lib/appels-offres/storage.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse) {
      return deniedResponse;
    }

    const { code } = await params;
    const filePath = await getAppelOffresPdfPath(code);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(code)}-cdc.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de charger le PDF.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
