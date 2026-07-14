import { NextResponse } from "next/server";
import {
  appendAuditLog,
  archiveAppelOffres,
  createProcessingJobByCode,
  finishProcessingJob,
  getAppelOffresDetailByCode,
  setAppelOffresBusinessStatus,
  setAppelOffresStatus,
  syncStoredDocumentsMetadata,
  updateAppelOffres
} from "@/lib/appels-offres/repository.ts";
import { storeSourcePdf } from "@/lib/appels-offres/storage.ts";
import { parseAppelOffresFormData } from "@/lib/appels-offres/validation.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    await syncStoredDocumentsMetadata(code).catch(() => undefined);
    const detail = await getAppelOffresDetailByCode(code, { includeArchived: true });

    if (!detail) {
      return NextResponse.json(
        { error: "Appel d'offres introuvable." },
        { status: 404 }
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  let jobId: number | null = null;

  try {
    const { code } = await params;
    const current = await getAppelOffresDetailByCode(code, { includeArchived: true });

    if (!current) {
      return NextResponse.json(
        { error: "Appel d'offres introuvable." },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const { input, file } = parseAppelOffresFormData(formData, {
      requireCode: false,
      requirePdf: false
    });
    const postedCode = formData.get("code");

    if (typeof postedCode === "string" && postedCode.trim() && postedCode.trim() !== code) {
      return NextResponse.json(
        { error: "Le code ne peut pas etre modifie." },
        { status: 400 }
      );
    }

    if (file && current.ficheStatus?.status === "processing") {
      return NextResponse.json(
        {
          error:
            "Impossible de remplacer le PDF pendant qu'une generation de fiche est en cours."
        },
        { status: 409 }
      );
    }

    const updated = await updateAppelOffres(code, {
      title: input.title,
      reference: input.reference,
      buyer: input.buyer,
      country: input.country,
      dueDate: input.dueDate,
      notes: input.notes,
      priorite: input.priorite,
      responsableCommercial: input.responsableCommercial
    });

    const changedFields = Object.entries({
      title: current.title !== input.title,
      reference: current.reference !== input.reference,
      buyer: current.buyer !== input.buyer,
      country: current.country !== input.country,
      dueDate: (current.dueDate ?? "") !== (input.dueDate ?? ""),
      notes: current.notes !== input.notes,
      priorite: current.priorite !== input.priorite,
      responsableCommercial:
        current.responsableCommercial !== input.responsableCommercial
    })
      .filter(([, changed]) => changed)
      .map(([field]) => field);

    await appendAuditLog(code, "appel_offres.updated", {
      changedFields,
      replacedSourcePdf: Boolean(file)
    });

    if (file) {
      await setAppelOffresStatus(code, "processing");
      const job = await createProcessingJobByCode(code, "appel_offres_update", {
        origin: "manual-update"
      });
      jobId = job.id;

      await storeSourcePdf(code, file);
      await appendAuditLog(code, "appel_offres.cdc_uploaded", {
        fileName: file.name || "cdc.pdf",
        source: "update"
      });
      await syncStoredDocumentsMetadata(code);
      await setAppelOffresBusinessStatus(code, "cdc_importe");
      await finishProcessingJob(jobId, "completed");
    }

    const detail = updated
      ? await getAppelOffresDetailByCode(code, { includeArchived: true })
      : null;
    return NextResponse.json(detail);
  } catch (error) {
    const { code } = await params;
    const message = asErrorMessage(error);

    if (jobId != null) {
      await finishProcessingJob(jobId, "failed", message).catch(() => undefined);
      await setAppelOffresStatus(code, "error").catch(() => undefined);
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const current = await getAppelOffresDetailByCode(code, { includeArchived: true });

    if (!current) {
      return NextResponse.json(
        { error: "Appel d'offres introuvable." },
        { status: 404 }
      );
    }

    if (current.ficheStatus?.status === "processing") {
      return NextResponse.json(
        {
          error:
            "Impossible d'archiver cet appel d'offres pendant qu'une generation est en cours."
        },
        { status: 409 }
      );
    }

    const archived = await archiveAppelOffres(code);
    await appendAuditLog(code, "appel_offres.archived", {
      previousStatus: current.status,
      archivedAt: archived?.archivedAt ?? current.archivedAt
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 400 }
    );
  }
}
