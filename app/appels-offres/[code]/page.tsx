import Link from "next/link";
import { notFound } from "next/navigation";
import { AppelOffresWorkspace } from "@/components/appel-offres-workspace.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { buildAppelOffresSummary } from "@/lib/appels-offres/presentation.ts";
import {
  getAppelOffresDetailByCode,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";

export default async function AppelOffresDetailPage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  await syncStoredDocumentsMetadata(code).catch(() => undefined);
  const appel = await getAppelOffresDetailByCode(code);

  if (!appel) {
    notFound();
  }

  const summary = buildAppelOffresSummary(appel);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace"
        title={appel.title}
        description="Dossier central de pilotage, de traitement documentaire et de validation de la Fiche CDC."
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
            <span className="page-meta-chip">Client : {summary.client}</span>
            <span className="page-meta-chip">Pays : {summary.country}</span>
            <span className="page-meta-chip">Progression : {summary.progressLabel}</span>
          </>
        }
      />

      <AppelOffresWorkspace appel={appel} />
    </div>
  );
}
