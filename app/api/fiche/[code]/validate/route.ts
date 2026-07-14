import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/appels-offres/repository.ts";
import { syncFicheIndexSafely } from "@/lib/db";
import {
  markFicheValidated,
  readFicheBundle,
  readFicheIndexSource
} from "@/lib/storage";

export const runtime = "nodejs";

const CONTROL_LABELS = {
  champs_non_trouves: "Champs non trouves",
  incoherences: "Incoherences",
  a_verifier: "A verifier"
} as const;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const current = await readFicheIndexSource(code);
    if (current.status.status !== "draft") {
      return NextResponse.json(
        {
          error: "Seule une fiche en brouillon peut etre validee."
        },
        { status: 409 }
      );
    }
    const controlItemsBySection = {
      champs_non_trouves: current.fiche.controle.champsNonTrouves,
      incoherences: current.fiche.controle.incoherences,
      a_verifier: current.fiche.controle.aVerifier
    } as const;
    const unresolved = current.fiche.controle.resolutions.filter(
      (resolution) => resolution.status === "unresolved"
    );

    if (unresolved.length) {
      const details = unresolved
        .map((resolution) => {
          const item = controlItemsBySection[resolution.section][resolution.index] ?? "Element inconnu";
          return `${CONTROL_LABELS[resolution.section]} #${resolution.index + 1}: ${item}`;
        })
        .join(" | ");

      return NextResponse.json(
        {
          error:
            `Impossible de valider : des elements de controle ne sont pas resolus. ${details}`
        },
        { status: 409 }
      );
    }

    await markFicheValidated(code);
    const indexed = await readFicheIndexSource(code);
    await syncFicheIndexSafely(
      code,
      indexed.xml,
      indexed.fiche,
      indexed.status,
      "validate"
    );
    await appendAuditLog(code, "fiche_cdc.validated", {
      validatedAt: indexed.status.validatedAt
    }).catch(() => undefined);
    const fiche = await readFicheBundle(code);
    return NextResponse.json(fiche);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de valider.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
