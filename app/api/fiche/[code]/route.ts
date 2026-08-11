import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/appels-offres/repository.ts";
import { syncFicheIndexSafely } from "@/lib/db";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { hasPermission } from "@/lib/auth/rbac.ts";
import {
  readFicheBundle,
  readFicheIndexSource,
  writeFicheBundle
} from "@/lib/storage";
import type { FichePayload } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse) {
      return deniedResponse;
    }

    const { code } = await params;
    const fiche = await readFicheBundle(code);
    return NextResponse.json(fiche);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de lire la fiche.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }
    if (!hasPermission(currentUser.role, "fiche_cdc.edit")) {
      return NextResponse.json({ error: "La Fiche CDC est accessible en lecture seule pour ce role." }, { status: 403 });
    }

    const { code } = await params;
    const payload = (await request.json()) as FichePayload;
    const fiche = await writeFicheBundle(code, payload);
    const indexed = await readFicheIndexSource(code);
    await syncFicheIndexSafely(code, indexed.xml, indexed.fiche, indexed.status, "save");
    await appendAuditLog(code, "fiche_cdc.saved", {
      extractionFields: payload.extraction.length,
      evaluationFields: payload.evaluation.length
    }).catch(() => undefined);
    return NextResponse.json(fiche);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de sauvegarder.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
