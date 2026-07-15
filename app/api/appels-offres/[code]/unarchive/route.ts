import { NextResponse } from "next/server";
import {
  appendAuditLog,
  getAppelOffresDetailByCode,
  unarchiveAppelOffres
} from "@/lib/appels-offres/repository.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

export async function POST(
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

    const unarchived = await unarchiveAppelOffres(code);

    await appendAuditLog(code, "appel_offres.unarchived", {
      previousStatus: current.status,
      nextStatus: unarchived?.status ?? current.status,
      idempotent: !current.archivedAt
    });

    return NextResponse.json(unarchived ?? current);
  } catch (error) {
    return NextResponse.json(
      { error: asErrorMessage(error) },
      { status: 400 }
    );
  }
}
