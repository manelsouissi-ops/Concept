import Link from "next/link";
import { notFound } from "next/navigation";
import { AppelOffresWorkspace } from "@/components/appel-offres-workspace.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { buildAppelOffresSummary } from "@/lib/appels-offres/presentation.ts";
import { buildWorkspaceIdentity } from "@/lib/appels-offres/workspace.ts";
import {
  getAppelOffresDetailByCode,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";

type WorkspaceFlash = "created-processing" | "launch-failed" | "analysis-started";
type WorkspaceView = "overview" | "documents" | "processing" | "fiche" | "history";

export default async function AppelOffresDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const flashValue = resolvedSearchParams?.flash;
  const viewValue = resolvedSearchParams?.view;
  const flash =
    typeof flashValue === "string" &&
    ["created-processing", "launch-failed", "analysis-started"].includes(flashValue)
      ? (flashValue as WorkspaceFlash)
      : undefined;
  const initialView =
    typeof viewValue === "string"
      ? viewValue === "fiche-cdc"
        ? "fiche"
        : ["overview", "documents", "processing", "fiche", "history"].includes(viewValue)
          ? (viewValue as WorkspaceView)
          : undefined
      : undefined;

  await syncStoredDocumentsMetadata(code).catch(() => undefined);
  const appel = await getAppelOffresDetailByCode(code);

  if (!appel) {
    notFound();
  }

  const summary = buildAppelOffresSummary(appel);
  const identity = buildWorkspaceIdentity(appel);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace"
        title={identity.displayTitle}
        description="Workspace central de pilotage, de traitement documentaire et de validation de la Fiche CDC."
        actions={
          <div className="actions">
            {appel.artifacts.hasFicheXml ? (
              <Link
                href={`/fiche/${encodeURIComponent(appel.code)}`}
                className="button button-secondary"
              >
                Ouvrir la Fiche CDC
              </Link>
            ) : null}
            <Link href="/appels-offres" className="button button-ghost">
              Retour à la liste
            </Link>
          </div>
        }
        metadata={
          <>
            <StatusBadge label={summary.statusLabel} tone={summary.statusTone} />
            <span className="page-meta-chip mono">{appel.code}</span>
            <span className="page-meta-chip">Client : {identity.clientLabel}</span>
            <span className="page-meta-chip">Pays : {identity.countryLabel}</span>
            <span className="page-meta-chip">Derniere mise a jour : {new Date(appel.updatedAt).toLocaleDateString("fr-FR")}</span>
          </>
        }
      />

      <AppelOffresWorkspace appel={appel} flash={flash} initialTab={initialView} />
    </div>
  );
}
