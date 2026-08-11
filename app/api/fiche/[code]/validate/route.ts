import { NextResponse } from "next/server";
import {
  appendAuditLog,
  applyValidatedExtractionIdentity,
  setAppelOffresBusinessStatus
} from "@/lib/appels-offres/repository.ts";
import { syncFicheIndexSafely } from "@/lib/db";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { hasPermission } from "@/lib/auth/rbac.ts";
import { autoAssignFciContributors } from "@/lib/appels-offres/workflow/service.ts";
import { notifyAssignedUser } from "@/lib/notifications/orchestration.ts";
import { autoInitializeAndLaunchFciModulesForValidatedFiche } from "@/lib/appels-offres/fci/service.ts";
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
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "appels_offres");
    if (deniedResponse || !currentUser) {
      return deniedResponse;
    }
    if (!hasPermission(currentUser.role, "fiche_cdc.validate")) {
      return NextResponse.json({ error: "Seul le Commercial peut valider la Fiche CDC." }, { status: 403 });
    }

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
    await setAppelOffresBusinessStatus(code, "fiche_validee", {
      validatedAt: indexed.status.validatedAt
    }).catch(() => undefined);
    const extractedTitle =
      indexed.fiche.extraction.find((field) => field.key === "intitule_mission")?.value ?? null;
    const extractedBuyer =
      indexed.fiche.extraction.find((field) => field.key === "client_maitre_ouvrage")?.value ?? null;
    const extractedCountry =
      indexed.fiche.extraction.find((field) => field.key === "pays")?.value ?? null;
    const extractedDeadline =
      indexed.fiche.extraction.find((field) => field.key === "date_limite_depot")?.value ?? null;
    const extractedReference =
      indexed.fiche.extraction.find((field) => field.key === "reference_officielle")?.value ?? null;
    await applyValidatedExtractionIdentity(code, {
      title: extractedTitle,
      buyer: extractedBuyer,
      country: extractedCountry,
      deadline: extractedDeadline,
      reference: extractedReference
    }).catch(() => undefined);
    await appendAuditLog(code, "fiche_cdc.validated", {
      validatedAt: indexed.status.validatedAt
    }).catch(() => undefined);
    await autoInitializeAndLaunchFciModulesForValidatedFiche(code).catch(() => undefined);
    const commercialUserId = Number(currentUser.id);
    if (Number.isInteger(commercialUserId) && commercialUserId > 0) {
      await notifyAssignedUser({
        appelOffreCode: code,
        moduleCode: "A",
        eventType: "FCI_ASSIGNED",
        recipientUserId: commercialUserId,
        recipientRole: "COMMERCIAL",
        currentUser,
        metadata: { assignedUserName: currentUser.name, automatic: true }
      });
    }
    await autoAssignFciContributors({ code, currentUser });
    const fiche = await readFicheBundle(code);
    return NextResponse.json(fiche);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de valider.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
