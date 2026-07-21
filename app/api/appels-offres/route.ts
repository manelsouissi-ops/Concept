import { NextResponse } from "next/server";
import {
  appendAuditLog,
  createAppelOffres,
  getAppelOffresDetailByCode,
  getAppelOffresRecordByCode,
  listAppelsOffres,
  setAppelOffresStatus,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";
import {
  AnalysisRequestError,
  launchAnalysisForAppelOffres
} from "@/lib/appels-offres/analysis.ts";
import {
  toBusinessSafeAnalysisError,
  toErrorMessage
} from "@/lib/appels-offres/user-errors.ts";
import { parseAppelOffresFormData } from "@/lib/appels-offres/validation.ts";
import { getMaxCdcUploadBytes } from "@/lib/integrations/n8n-config.ts";

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

function buildWorkspaceRedirectUrl(code: string, flash: "created-processing" | "launch-failed") {
  const params = new URLSearchParams({
    view: "processing",
    flash
  });

  return `/appels-offres/${encodeURIComponent(code)}?${params.toString()}`;
}

function validatePdfSize(file: File) {
  const maxCdcUploadBytes = getMaxCdcUploadBytes();

  if (file.size > maxCdcUploadBytes) {
    throw new AnalysisRequestError(
      413,
      `Le PDF depasse la taille maximale autorisee (${maxCdcUploadBytes} octets).`
    );
  }
}

function isEnvironmentConfigurationError(error: unknown) {
  return error instanceof Error && error.message.startsWith("La variable d'environnement ");
}

function isDatabaseError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error;
}

function getFailureKind(error: unknown) {
  if (error instanceof AnalysisRequestError) {
    return error.kind;
  }

  if (isEnvironmentConfigurationError(error)) {
    return "missing_environment_variable";
  }

  if (isDatabaseError(error)) {
    return "database_error";
  }

  return "validation_error";
}

function getFailureStatus(error: unknown) {
  if (error instanceof AnalysisRequestError) {
    return error.status;
  }

  if (isUniqueViolation(error)) {
    return 409;
  }

  if (isEnvironmentConfigurationError(error) || isDatabaseError(error)) {
    return 500;
  }

  return 400;
}

function logCreateFailure(
  event: string,
  input: {
    code: string;
    created: boolean;
    failureKind: string;
    status: number;
    redirectUrl?: string | null;
    processingJobId?: string | null;
    correlationId?: string | null;
  },
  error: unknown
) {
  console.error(`[appels-offres.create] ${event}`, {
    code: input.code || null,
    created: input.created,
    failureKind: input.failureKind,
    status: input.status,
    redirectUrl: input.redirectUrl ?? null,
    processingJobId: input.processingJobId ?? null,
    correlationId: input.correlationId ?? null,
    errorMessage: asErrorMessage(error)
  });

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
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
  let created = false;

  try {
    const formData = await request.formData();
    const { input, file } = parseAppelOffresFormData(formData, {
      requireCode: true,
      requirePdf: true,
      requireTitle: false
    });

    code = input.code;
    validatePdfSize(file!);

    const existing = await getAppelOffresRecordByCode(code);
    if (existing) {
      return NextResponse.json(
        { error: "Un appel d'offres avec ce code existe deja." },
        { status: 409 }
      );
    }

    await createAppelOffres({
      ...input,
      title: input.title || input.code,
      status: "processing",
      businessStatus: "brouillon",
      source: "manual"
    });
    created = true;

    await appendAuditLog(code, "appel_offres.create.requested", {
      hasSourcePdf: true
    });

    try {
      const launched = await launchAnalysisForAppelOffres({
        code,
        pdfFile: file,
        source: "api-appels-offres-create"
      });

      await syncStoredDocumentsMetadata(code).catch(() => undefined);
      await appendAuditLog(code, "appel_offres.created", {
        status: "processing",
        priorite: input.priorite,
        responsableCommercial: input.responsableCommercial || null,
        processingJobId: launched.processingJobId
      }).catch(() => undefined);

      const detail = await getAppelOffresDetailByCode(code, { includeArchived: true });
      return NextResponse.json(
        {
          detail,
          redirect_url: buildWorkspaceRedirectUrl(code, "created-processing"),
          analysis: {
            status: "processing",
            processing_job_id: launched.processingJobId,
            correlation_id: launched.correlationId,
            execution_id: launched.executionId,
            callback_url: launched.callbackUrl
          }
        },
        { status: 201 }
      );
    } catch (error) {
      const detail = await getAppelOffresDetailByCode(code, { includeArchived: true });
      const latestJob = detail?.processingJobs[0] ?? null;
      const failureKind = getFailureKind(error);
      const failureStatus = getFailureStatus(error);
      const safeError = toBusinessSafeAnalysisError(
        error instanceof AnalysisRequestError
          ? toErrorMessage(error.body.error) || error.message
          : asErrorMessage(error)
      );

      await appendAuditLog(code, "appel_offres.created", {
        status: "error",
        priorite: input.priorite,
        responsableCommercial: input.responsableCommercial || null,
        analysisLaunchFailed: true
      }).catch(() => undefined);

      logCreateFailure(
        "launch_failed_after_create",
        {
          code,
          created: true,
          failureKind,
          status: failureStatus,
          redirectUrl: buildWorkspaceRedirectUrl(code, "launch-failed"),
          processingJobId: latestJob?.publicId ?? null,
          correlationId: latestJob?.correlationId ?? null
        },
        error
      );

      return NextResponse.json(
        {
          detail,
          redirect_url: buildWorkspaceRedirectUrl(code, "launch-failed"),
          analysis: {
            status: "failed",
            processing_job_id: latestJob?.publicId ?? null,
            correlation_id: latestJob?.correlationId ?? null,
            execution_id: latestJob?.executionId ?? null,
            error: safeError,
            error_kind: failureKind,
            error_status: failureStatus
          }
        },
        { status: 201 }
      );
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: "Un appel d'offres avec ce code existe deja.",
          error_kind: "validation_error"
        },
        { status: 409 }
      );
    }

    const failureKind = getFailureKind(error);
    const failureStatus = getFailureStatus(error);
    const message = toBusinessSafeAnalysisError(asErrorMessage(error));

    if (created && code) {
      await setAppelOffresStatus(code, "error").catch(() => undefined);
      await appendAuditLog(code, "appel_offres.create.failed", {
        error: message
      }).catch(() => undefined);
    }

    logCreateFailure(
      "request_failed",
      {
        code,
        created,
        failureKind,
        status: failureStatus
      },
      error
    );

    return NextResponse.json(
      {
        error: message,
        error_kind: failureKind
      },
      { status: failureStatus }
    );
  }
}
