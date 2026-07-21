"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ActivityFeed } from "@/components/activity-feed.tsx";
import { AiBadge } from "@/components/ai-badge";
import { AppelOffresAnalysisPanel } from "@/components/appel-offres-analysis-panel";
import { AppelOffresForm } from "@/components/appel-offres-form";
import { EmptyState } from "@/components/empty-state.tsx";
import { ProcessingTimeline } from "@/components/processing-timeline.tsx";
import { WorkspaceHeader } from "@/components/workspace-header.tsx";
import { WorkspaceTabs } from "@/components/workspace-tabs.tsx";
import { buildAppelOffresSummary } from "@/lib/appels-offres/presentation.ts";
import {
  buildProcessingTimeline,
  buildWorkspaceActions,
  buildWorkspaceActivityFeed,
  buildWorkspaceFailureSummary,
  buildWorkspaceIdentity,
  type WorkspaceAction,
  type WorkspaceTabKey
} from "@/lib/appels-offres/workspace.ts";
import type { AppelOffresDetail } from "@/lib/appels-offres/types.ts";
import { FicheEditor } from "./fiche-editor.tsx";

type WorkspaceFlash = "created-processing" | "launch-failed" | "analysis-started";

const tabs: Array<{ key: WorkspaceTabKey; label: string; countKey?: "documents" | "history" }> = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "documents", label: "Documents", countKey: "documents" },
  { key: "processing", label: "Traitement" },
  { key: "fiche", label: "Fiche CDC" },
  { key: "history", label: "Historique", countKey: "history" }
];

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Non renseignee";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

function formatBytes(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return "En cours";
  }

  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "Non disponible";
  }

  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

function getFlashContent(flash: WorkspaceFlash | undefined) {
  switch (flash) {
    case "created-processing":
      return {
        tone: "info" as const,
        message: "Le dossier a ete cree. L'analyse du CDC est en cours."
      };
    case "launch-failed":
      return {
        tone: "warning" as const,
        message:
          "Le dossier a ete cree, mais le lancement de l'analyse a echoue. Vous pouvez relancer le traitement ci-dessous."
      };
    case "analysis-started":
      return {
        tone: "info" as const,
        message: "L'analyse du CDC est en cours."
      };
    default:
      return null;
  }
}

function toViewParam(tab: WorkspaceTabKey) {
  return tab === "fiche" ? "fiche-cdc" : tab;
}

export function AppelOffresWorkspace({
  appel,
  initialTab = "overview",
  flash
}: {
  appel: AppelOffresDetail;
  initialTab?: WorkspaceTabKey;
  flash?: WorkspaceFlash;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>(initialTab);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const summary = buildAppelOffresSummary(appel);
  const identity = buildWorkspaceIdentity(appel);
  const timeline = buildProcessingTimeline(appel);
  const activity = buildWorkspaceActivityFeed(appel);
  const failureSummary = buildWorkspaceFailureSummary(appel);
  const flashContent = getFlashContent(flash);
  const latestJob = appel.processingJobs[0] ?? null;
  const actions = buildWorkspaceActions(appel);

  const tabConfigs = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        count:
          tab.countKey === "documents"
            ? appel.documents.length
            : tab.countKey === "history"
              ? activity.length
              : undefined
      })),
    [activity.length, appel.documents.length]
  );

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  function updateView(nextTab: WorkspaceTabKey) {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", toViewParam(nextTab));
    params.delete("flash");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function handleArchiveToggle(archived: boolean) {
    const response = await fetch(
      archived
        ? `/api/appels-offres/${encodeURIComponent(appel.code)}/unarchive`
        : `/api/appels-offres/${encodeURIComponent(appel.code)}/archive`,
      {
        method: "POST"
      }
    );

    if (response.ok) {
      router.refresh();
    }
  }

  async function handleLaunchAnalysis() {
    setWorkspaceMessage(null);

    startTransition(async () => {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(appel.code)}/analyse`, {
        method: "POST",
        body: new FormData()
      });

      const body = (await response.json()) as {
        error?: string;
        requiresConfirmation?: boolean;
      };

      if (response.ok) {
        updateView("processing");
        router.refresh();
        return;
      }

      if (response.status === 409 && body.requiresConfirmation) {
        updateView("processing");
        setWorkspaceMessage(
          body.error ??
            "La relance doit etre confirmee depuis la section Traitement."
        );
        return;
      }

      updateView("processing");
      setWorkspaceMessage(body.error ?? "Le lancement de l'analyse a echoue.");
    });
  }

  function handleAction(action: WorkspaceAction) {
    switch (action.kind) {
      case "launch-analysis":
        void handleLaunchAnalysis();
        break;
      case "open-fiche":
      case "validate-fiche":
        updateView("fiche");
        break;
      case "download-cdc":
        window.open(`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`, "_blank", "noopener,noreferrer");
        break;
      case "edit-overview":
        updateView("overview");
        break;
      case "archive":
        void handleArchiveToggle(false);
        break;
      case "unarchive":
        void handleArchiveToggle(true);
        break;
    }
  }

  return (
    <div className="stack">
      <WorkspaceHeader
        code={appel.code}
        identity={identity}
        statusLabel={summary.statusLabel}
        statusTone={summary.statusTone}
        businessStatusDescription={summary.statusDescription}
        lastUpdatedLabel={formatDateTime(appel.updatedAt)}
        deadlineLabel={formatDate(appel.dueDate)}
        primaryAction={actions.primary}
        secondaryActions={actions.secondary}
        onAction={handleAction}
      />

      <section className="tabs-card">
        {flashContent ? (
          <div className={flashContent.tone === "warning" ? "callout warning" : "callout info"}>
            {flashContent.message}
          </div>
        ) : null}
        {workspaceMessage ? <div className="callout warning">{workspaceMessage}</div> : null}

        <WorkspaceTabs tabs={tabConfigs} activeKey={activeTab} onSelect={(key) => updateView(key as WorkspaceTabKey)} />

        <div className="tabs-panel">
          {activeTab === "overview" ? (
            <div className="stack">
              <div className="responsive-card-grid">
                <article className="workspace-card">
                  <span className="card-kicker">Projet</span>
                  <h3>{identity.displayTitle}</h3>
                  <p className="workspace-card-description">
                    {identity.clientLabel} · {identity.countryLabel}
                  </p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Action suivante</span>
                  <h3>{summary.nextAction}</h3>
                  <p className="workspace-card-description">{summary.currentStep}</p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Pilotage</span>
                  <h3>{summary.ownerLabel}</h3>
                  <p className="workspace-card-description">
                    Date limite : {formatDate(appel.dueDate)} · Priorite {summary.priorityLabel}
                  </p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Fiche CDC</span>
                  <h3>{summary.ficheStatusLabel}</h3>
                  <p className="workspace-card-description">
                    Derniere mise a jour {formatDateTime(appel.updatedAt)}
                  </p>
                </article>
              </div>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Documents cles</h3>
                    <p className="meta">
                      Les artefacts reels disponibles a cette etape du projet.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {appel.documents.length ? (
                    <div className="responsive-card-grid">
                      {appel.documents.slice(0, 3).map((document) => (
                        <article key={document.id} className="document-artifact-card">
                          <span className="card-kicker">
                            {document.kind === "source_pdf"
                              ? "Document original"
                              : document.kind === "status_json"
                                ? "Trace de traitement"
                                : "Artefact genere"}
                          </span>
                          <h3>{document.fileName}</h3>
                          <p className="workspace-card-description">
                            {formatBytes(document.sizeBytes)} octets · {formatDateTime(document.createdAt)}
                          </p>
                          <div className="workspace-card-actions">
                            {document.kind === "source_pdf" ? (
                              <Link
                                href={`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`}
                                className="button button-secondary button-small"
                                target="_blank"
                              >
                                Ouvrir
                              </Link>
                            ) : null}
                            {document.kind === "fiche_xml" ? (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                onClick={() => updateView("fiche")}
                              >
                                Voir la Fiche CDC
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="Aucun document disponible"
                      description="Le workspace affichera le CDC et les artefacts generes des qu'ils seront disponibles."
                    />
                  )}
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Activite recente</h3>
                    <p className="meta">
                      Les derniers evenements utiles au suivi commercial du dossier.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {activity.length ? (
                    <ActivityFeed items={activity.slice(0, 5)} />
                  ) : (
                    <EmptyState
                      compact
                      title="Aucune activite recente"
                      description="Les prochains evenements apparaitront ici des que le dossier evoluera."
                    />
                  )}
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Informations du projet</h3>
                    <p className="meta">
                      Mise a jour directe des metadonnees deja supportees par la plateforme.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  <AppelOffresForm
                    mode="edit"
                    current={appel}
                    initialValue={{
                      code: appel.code,
                      title: appel.title,
                      reference: appel.reference,
                      buyer: appel.buyer,
                      country: appel.country,
                      dueDate: appel.dueDate ?? "",
                      notes: appel.notes,
                      priorite: appel.priorite,
                      responsableCommercial: appel.responsableCommercial
                    }}
                  />
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "documents" ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Documents disponibles</h3>
                    <p className="meta">
                      Documents originaux et artefacts reels de traitement relies a cet appel d'offres.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {appel.documents.length ? (
                    <div className="document-grid">
                      {appel.documents.map((document) => (
                        <article key={document.id} className="document-artifact-card">
                          <span className="card-kicker">
                            {document.kind === "source_pdf"
                              ? "Original"
                              : document.kind === "status_json"
                                ? "Suivi de traitement"
                                : "Genere automatiquement"}
                          </span>
                          <h3>{document.fileName}</h3>
                          <div className="document-artifact-meta">
                            <span>Type : {document.kind}</span>
                            <span>Taille : {formatBytes(document.sizeBytes)} octets</span>
                            <span>Disponible depuis : {formatDateTime(document.createdAt)}</span>
                            <span>Disponibilite : Active</span>
                          </div>
                          <div className="workspace-card-actions">
                            {document.kind === "source_pdf" ? (
                              <Link
                                href={`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`}
                                className="button button-secondary button-small"
                                target="_blank"
                              >
                                Ouvrir le CDC
                              </Link>
                            ) : null}
                            {document.kind === "fiche_xml" ? (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                onClick={() => updateView("fiche")}
                              >
                                Ouvrir la Fiche CDC
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="Aucun document indexe"
                      description="Importez un CDC pour creer le premier ensemble documentaire de cet appel d'offres."
                    />
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "processing" ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Traitement du dossier</h3>
                    <p className="meta">
                      Timeline metier basee sur les jobs de traitement, les artefacts et les evenements reels.
                    </p>
                  </div>
                </div>
                <div className="section-body stack">
                  {summary.statusKey === "analyse_en_cours" ? (
                    <div className="callout ai">
                      <AiBadge label="Analyse IA" />
                      <strong>Analyse en cours</strong>
                      <div>Le workflow traite actuellement le CDC et preparera la Fiche CDC des que le resultat sera disponible.</div>
                    </div>
                  ) : null}

                  {failureSummary ? (
                    <div className="callout warning">
                      <strong>L'analyse n'a pas pu etre terminee.</strong>
                      <div>{failureSummary.message}</div>
                      <div>
                        Etape en echec : {failureSummary.stageLabel}
                        {failureSummary.failedAt ? ` · ${formatDateTime(failureSummary.failedAt)}` : ""}
                      </div>
                    </div>
                  ) : null}

                  <ProcessingTimeline steps={timeline} />

                  <div className="responsive-card-grid">
                    <article className="workspace-card">
                      <span className="card-kicker">Statut</span>
                      <h3>{summary.processingStateLabel}</h3>
                      <p className="workspace-card-description">{summary.currentStep}</p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Demarrage</span>
                      <h3>{formatDateTime(latestJob?.startedAt ?? null)}</h3>
                      <p className="workspace-card-description">
                        Fin : {formatDateTime(latestJob?.finishedAt ?? null)}
                      </p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Duree</span>
                      <h3>{formatDuration(latestJob?.startedAt ?? null, latestJob?.finishedAt ?? null)}</h3>
                      <p className="workspace-card-description">
                        Prochaine action : {summary.nextAction}
                      </p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Relance</span>
                      <h3>{failureSummary?.retryAvailable ? "Disponible" : "Non necessaire"}</h3>
                      <p className="workspace-card-description">
                        Utilise l'endpoint canonique de relance deja en place.
                      </p>
                    </article>
                  </div>

                  {latestJob ? (
                    <details className="technical-details">
                      <summary className="markdown-summary">Details techniques (administration)</summary>
                      <div className="technical-details-grid">
                        <span>Execution ID : {latestJob.executionId ?? "Non disponible"}</span>
                        <span>Correlation ID : {latestJob.correlationId ?? "Non disponible"}</span>
                        <span>Contract version : {latestJob.contractVersion ?? "Non disponible"}</span>
                        <span>Etape d'erreur : {latestJob.errorStage ?? "Aucune"}</span>
                        <span>Code erreur : {latestJob.errorCode ?? "Aucun"}</span>
                      </div>
                    </details>
                  ) : null}

                  <AppelOffresAnalysisPanel
                    code={appel.code}
                    hasSourcePdf={appel.artifacts.hasSourcePdf}
                    ficheStatus={appel.ficheStatus?.status ?? null}
                    hasFicheXml={appel.artifacts.hasFicheXml}
                  />
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "fiche" ? (
            appel.artifacts.hasFicheXml || appel.ficheStatus ? (
              <div className="stack">
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <h3>Revue de la Fiche CDC</h3>
                      <p className="meta">
                        Revoyez, corrigez et validez les informations generees avant la suite du processus.
                      </p>
                    </div>
                  </div>
                  <div className="section-body stack">
                    <div className="responsive-card-grid">
                      <article className="workspace-card">
                        <span className="card-kicker">Etat</span>
                        <h3>{summary.ficheStatusLabel}</h3>
                        <p className="workspace-card-description">
                          Derniere mise a jour {formatDateTime(appel.updatedAt)}
                        </p>
                      </article>
                      <article className="workspace-card">
                        <span className="card-kicker">Validation</span>
                        <h3>{appel.ficheStatus?.status === "validated" ? "Validee" : "A verifier"}</h3>
                        <p className="workspace-card-description">
                          Une fois validee, la fiche servira de base a la future phase FCI.
                        </p>
                      </article>
                    </div>
                    <FicheEditor code={appel.code} />
                  </div>
                </section>
              </div>
            ) : (
              <EmptyState
                title="Fiche CDC indisponible"
                description="Lancez d'abord l'analyse du CDC pour generer la Fiche CDC a relire."
                action={
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => updateView("processing")}
                  >
                    Aller au traitement
                  </button>
                }
              />
            )
          ) : null}

          {activeTab === "history" ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Historique du dossier</h3>
                    <p className="meta">
                      Activite utile au suivi du projet, sans bruit technique inutile.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {activity.length ? (
                    <ActivityFeed items={activity} />
                  ) : (
                    <EmptyState
                      compact
                      title="Historique indisponible"
                      description="Les evenements s'afficheront ici a mesure que l'appel d'offres evoluera."
                    />
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
