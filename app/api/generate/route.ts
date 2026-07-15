import { NextResponse } from "next/server";
import {
  ensureAppelOffresRecord,
  getAppelOffresRecordByCode
} from "@/lib/appels-offres/repository.ts";
import { launchAnalysisForAppelOffres, AnalysisRequestError } from "@/lib/appels-offres/analysis.ts";

export const runtime = "nodejs";

function asNonEmptyString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function asTruthyFlag(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isPdfFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

async function ensureCompatibilityAppelOffres(code: string, hasFile: boolean) {
  await ensureAppelOffresRecord({
    code,
    title: code,
    reference: "",
    buyer: "",
    country: "",
    dueDate: null,
    notes: "",
    priorite: "normale",
    responsableCommercial: "",
    status: hasFile ? "ready" : "draft",
    businessStatus: hasFile ? "cdc_importe" : "brouillon",
    source: "fiche-flow"
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const code = asNonEmptyString(formData.get("code_interne"));
    const forceRegenerate = asTruthyFlag(formData.get("force_regenerate"));
    const fileEntry = formData.get("file");
    const file = isPdfFile(fileEntry) ? fileEntry : null;

    if (!code) {
      return NextResponse.json(
        { error: "Le code interne est obligatoire." },
        { status: 400 }
      );
    }

    const existing = await getAppelOffresRecordByCode(code, { includeArchived: true });
    if (!existing && !file) {
      return NextResponse.json(
        { error: "Le PDF est obligatoire." },
        { status: 400 }
      );
    }

    if (!existing) {
      await ensureCompatibilityAppelOffres(code, Boolean(file));
    }

    const launched = await launchAnalysisForAppelOffres({
      code,
      pdfFile: file,
      forceRegenerate,
      source: "api-generate"
    });

    return NextResponse.json(
      {
        code: launched.code,
        code_interne: launched.code,
        status: "processing",
        processing_job_id: launched.processingJobId,
        correlation_id: launched.correlationId,
        n8nExecutionId: launched.executionId
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof AnalysisRequestError) {
      return NextResponse.json(error.body, { status: error.status });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Impossible de generer la fiche projet.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
