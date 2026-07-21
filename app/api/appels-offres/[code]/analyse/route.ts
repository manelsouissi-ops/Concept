import { NextResponse } from "next/server";
import { AnalysisRequestError, launchAnalysisForAppelOffres } from "@/lib/appels-offres/analysis.ts";
import {
  toBusinessSafeAnalysisError,
  toErrorMessage
} from "@/lib/appels-offres/user-errors.ts";

export const runtime = "nodejs";

function logAnalysisRouteFailure(
  code: string,
  status: number,
  errorKind: string,
  error: unknown
) {
  console.error("[appels-offres.analyse] request_failed", {
    code,
    status,
    errorKind,
    errorMessage: error instanceof Error ? error.message : String(error)
  });

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}

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
      logAnalysisRouteFailure(
        (await params).code,
        error.status,
        error.kind,
        error
      );
      return NextResponse.json(
        {
          ...error.body,
          error: toBusinessSafeAnalysisError(toErrorMessage(error.body.error) || error.message),
          error_kind: error.kind
        },
        { status: error.status }
      );
    }

    const { code } = await params;
    const message =
      error instanceof Error
        ? toBusinessSafeAnalysisError(error.message)
        : "Impossible de lancer l'analyse.";
    logAnalysisRouteFailure(code, 500, "unexpected_error", error);
    return NextResponse.json(
      {
        error: message,
        error_kind: "unexpected_error"
      },
      { status: 500 }
    );
  }
}
