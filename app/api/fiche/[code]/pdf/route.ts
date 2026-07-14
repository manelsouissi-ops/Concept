import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getStoredPdfPath } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const pdfPath = await getStoredPdfPath(code);
    const pdfBuffer = await readFile(pdfPath);

    return new NextResponse(pdfBuffer, {
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
