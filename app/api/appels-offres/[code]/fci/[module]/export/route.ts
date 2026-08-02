import { NextResponse } from "next/server";
import { generateFciExportArtifact, parseFciExportFormat, FciExportError } from "@/lib/appels-offres/fci/export/index.ts";
import { getFciModule, parseRequestedModule, toFciErrorResponse } from "@/lib/appels-offres/fci/service.ts";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; module: string }> }
) {
  try {
    const { code, module } = await params;
    const url = new URL(request.url);
    const format = parseFciExportFormat(url.searchParams.get("format"));
    const modulePresentation = await getFciModule(
      code,
      parseRequestedModule(module),
      await resolveCurrentUserFromRequest(request)
    );
    const artifact = await generateFciExportArtifact(modulePresentation, format);

    return new NextResponse(new Uint8Array(artifact.buffer), {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof FciExportError) {
      console.error("[fci-export]", {
        code: error.code,
        message: error.message
      });
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

    const { status, body } = toFciErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
