import { NextResponse } from "next/server";
import { getCurrentFicheStatusForApi } from "@/lib/appels-offres/analysis.ts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const status = await getCurrentFicheStatusForApi(code);

    if (!status) {
      return NextResponse.json(
        { error: "Impossible de lire le statut." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: status.status,
      processingStartedAt: status.processingStartedAt,
      errorReason: status.errorReason,
      errorStage: status.errorStage,
      n8nExecutionId: status.n8nExecutionId
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de lire le statut.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
