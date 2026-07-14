import { NextResponse } from "next/server";
import {
  appendAuditLog,
  createAppelOffres,
  createProcessingJobByCode,
  finishProcessingJob,
  getAppelOffresDetailByCode,
  getAppelOffresRecordByCode,
  listAppelsOffres,
  setAppelOffresBusinessStatus,
  setAppelOffresStatus,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";
import { storeSourcePdf } from "@/lib/appels-offres/storage.ts";
import { parseAppelOffresFormData } from "@/lib/appels-offres/validation.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appelsOffres = await listAppelsOffres({
      search: searchParams.get("search") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      priorite: searchParams.get("priorite") ?? undefined,
      pays: searchParams.get("pays") ?? undefined,
      client: searchParams.get("client") ?? undefined,
      archived:
        (searchParams.get("archived") as "true" | "false" | "all" | null) ?? undefined,
      sort: searchParams.get("sort") ?? undefined
    });
    return NextResponse.json(appelsOffres);
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let code = "";
  let jobId: number | null = null;
  let created = false;

  try {
    const formData = await request.formData();
    const { input, file } = parseAppelOffresFormData(formData, {
      requireCode: true,
      requirePdf: true
    });

    code = input.code;

    const existing = await getAppelOffresRecordByCode(code);
    if (existing) {
      return NextResponse.json(
        { error: "Un appel d'offres avec ce code existe deja." },
        { status: 409 }
      );
    }

    await createAppelOffres({
      ...input,
      status: "processing",
      businessStatus: "brouillon",
      source: "manual"
    });
    created = true;

    await appendAuditLog(code, "appel_offres.create.requested", {
      hasSourcePdf: true
    });

    const job = await createProcessingJobByCode(code, "appel_offres_upload", {
      origin: "manual-create"
    });
    jobId = job.id;

    await storeSourcePdf(code, file!);
    await appendAuditLog(code, "appel_offres.cdc_uploaded", {
      fileName: file?.name ?? "cdc.pdf"
    });
    await syncStoredDocumentsMetadata(code);
    await setAppelOffresBusinessStatus(code, "cdc_importe");
    await finishProcessingJob(jobId, "completed");
    await appendAuditLog(code, "appel_offres.created", {
      status: "ready",
      priorite: input.priorite,
      responsableCommercial: input.responsableCommercial || null
    });

    const detail = await getAppelOffresDetailByCode(code);
    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Un appel d'offres avec ce code existe deja." },
        { status: 409 }
      );
    }

    const message = asErrorMessage(error);

    if (jobId != null) {
      await finishProcessingJob(jobId, "failed", message).catch(() => undefined);
    }

    if (created && code) {
      await setAppelOffresStatus(code, "error").catch(() => undefined);
      await appendAuditLog(code, "appel_offres.create.failed", {
        error: message
      }).catch(() => undefined);
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
