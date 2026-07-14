import { NextResponse } from "next/server";
import { AnalysisRequestError, launchAnalysisForAppelOffres } from "@/lib/appels-offres/analysis.ts";

export const runtime = "nodejs";

function asTruthyFlag(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getOptionalPdfFile(value: FormDataEntryValue | null) {
  return value instanceof File ? value : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const formData = await request.formData();
    const launched = await launchAnalysisForAppelOffres({
      code,
      pdfFile: getOptionalPdfFile(formData.get("file")),
      forceRegenerate: asTruthyFlag(formData.get("force_regenerate")),
      source: "api-appels-offres-analyse"
    });

    return NextResponse.json(
      {
        code: launched.code,
        status: "processing",
        processing_job_id: launched.processingJobId,
        correlation_id: launched.correlationId,
        execution_id: launched.executionId,
        callback_url: launched.callbackUrl
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof AnalysisRequestError) {
      return NextResponse.json(error.body, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Impossible de lancer l'analyse.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
