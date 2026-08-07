import { NextResponse } from "next/server";
import {
  generateGoNoGoReportExportArtifact,
  GoNoGoReportExportError
} from "@/lib/appels-offres/go-no-go-report/export.ts";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }

    const { code } = await params;
    const url = new URL(request.url);
    const artifact = await generateGoNoGoReportExportArtifact(
      code,
      url.searchParams.get("format"),
      currentUser
    );

    return new NextResponse(artifact.buffer, {
      status: 200,
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`
      }
    });
  } catch (error) {
    if (error instanceof GoNoGoReportExportError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: {}
          }
        },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : "Export Go/No-Go inattendu.";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "GO_NO_GO_REPORT_EXPORT_INTERNAL_ERROR",
          message,
          details: {}
        }
      },
      { status: 500 }
    );
  }
}
