"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppelOffresAnalysisPanel } from "@/components/appel-offres-analysis-panel";
import { AppelOffresForm } from "@/components/appel-offres-form";
import { EmptyState } from "@/components/empty-state.tsx";
import { PlaceholderPanel } from "@/components/placeholder-panel.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import {
  buildAppelOffresSummary,
  buildProgressStepper,
  getDocumentLabel
} from "@/lib/appels-offres/presentation.ts";
import type { AppelOffresDetail } from "@/lib/appels-offres/types.ts";
import { FicheEditor } from "./fiche-editor.tsx";

type WorkspaceTab =
  | "overview"
  | "documents"
  | "processing"
  | "fiche"
  | "fci"
  | "knowledge"
  | "history";

const tabs: Array<{ key: WorkspaceTab; label: string }> = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "documents", label: "Documents" },
  { key: "processing", label: "Traitement" },
  { key: "fiche", label: "Fiche CDC" },
  { key: "fci", label: "FCI" },
  { key: "knowledge", label: "Connaissances" },
  { key: "history", label: "Historique" }
];

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Non renseignée";
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

export function AppelOffresWorkspace({ appel }: { appel: AppelOffresDetail }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const summary = buildAppelOffresSummary(appel);
  const steps = buildProgressStepper(appel);
  const latestJob = appel.processingJobs[0] ?? null;

  async function handleArchiveToggle() {
    const response = await fetch(
      summary.isArchived
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

  return (
    <div className="stack">
      <section className="workspace-header-card">
        <div className="workspace-header-topline">
          <div>
            <div className="workspace-code mono">{appel.code}</div>
            <h2>{appel.title}</h2>
          </div>
          <StatusBadge label={summary.statusLabel} tone={summary.statusTone} />
        </div>

        <div className="workspace-header-actions">
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setActiveTab("overview")}
          >
            Modifier
          </button>
          <button
            type="button"
            className="button button-primary button-small"
            onClick={() => setActiveTab("processing")}
          >
            {summary.statusKey === "erreur" ? "Relancer l'analyse" : "Lancer l'analyse"}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setActiveTab("history")}
          >
            Plus
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => void handleArchiveToggle()}
          >
            {summary.isArchived ? "Desarchiver" : "Archiver"}
          </button>
        </div>

        <div className="workspace-header-grid">
          <div className="workspace-header-meta">
            <span>Client : {summary.client}</span>
            <span>Pays : {summary.country}</span>
            <span>Priorite : {summary.priorityLabel}</span>
            <span>Responsable : {summary.ownerLabel}</span>
            <span>Date limite : {formatDate(appel.dueDate)}</span>
            <span>Derniere mise a jour : {formatDateTime(appel.updatedAt)}</span>
            <span>
              Archive : {summary.isArchived ? `Oui (${formatDateTime(summary.archivedAt)})` : "Non"}
            </span>
          </div>

          <div className="workspace-header-progress">
            <div className="progress-label-row">
              <strong>Progression globale</strong>
              <span>{summary.progressLabel}</span>
            </div>
            <div className="progress-bar large">
              <span style={{ width: `${summary.progressValue}%` }} />
            </div>
            <p>{summary.currentStep}</p>
          </div>
        </div>
      </section>

      <section className="tabs-card">
        <div className="tabs-list" role="tablist" aria-label="Sections du workspace">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "tab-button active" : "tab-button"}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tabs-panel">
          {activeTab === "overview" ? (
            <div className="stack">
              <div className="responsive-card-grid">
                <article className="workspace-card">
                  <span className="card-kicker">Statut courant</span>
                  <h3>{summary.statusLabel}</h3>
                  <p className="workspace-card-description">{summary.statusDescription}</p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Action suivante</span>
                  <h3>{summary.nextAction}</h3>
                  <p className="workspace-card-description">
                    Étape actuelle : {summary.currentStep}
                  </p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Documents</span>
                  <h3>{summary.documentsCount} document(s)</h3>
                  <p className="workspace-card-description">
                    CDC PDF {summary.hasSourcePdf ? "présent" : "absent"} · Fiche structurée{" "}
                    {summary.hasStructuredFiche ? "présente" : "absente"}
                  </p>
                </article>
                <article className="workspace-card">
                  <span className="card-kicker">Fiche CDC</span>
                  <h3>{summary.ficheStatusLabel}</h3>
                  <p className="workspace-card-description">
                    Dernier traitement : {summary.latestJobLabel ?? "Aucun"}
                  </p>
                </article>
              </div>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Étapes du processus</h3>
                    <p className="meta">
                      Visualisation métier de l'avancement du dossier.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  <ol className="stepper-list">
                    {steps.map((step) => (
                      <li
                        key={step.key}
                        className={[
                          "stepper-item",
                          step.completed ? "completed" : "",
                          step.current ? "current" : "",
                          step.disabled ? "disabled" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="stepper-bullet" />
                        <span>{step.label}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Informations du dossier</h3>
                    <p className="meta">
                      Mise à jour directe des métadonnées déjà supportées par la plateforme.
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

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Activité récente</h3>
                    <p className="meta">
                      Derniers événements réellement enregistrés pour cet appel d'offres.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {appel.auditLogs.length ? (
                    <div className="timeline-list">
                      {appel.auditLogs.slice(0, 5).map((entry) => (
                        <article key={entry.id} className="timeline-item">
                          <div className="timeline-dot" />
                          <div className="timeline-content">
                            <strong>{entry.action}</strong>
                            <span>{formatDateTime(entry.createdAt)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="Aucune activité récente"
                      description="Les prochains événements apparaîtront ici dès que le dossier évoluera."
                    />
                  )}
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
                      Tous les artefacts actuellement connus pour cet appel d'offres.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {appel.documents.length ? (
                    <div className="document-table">
                      {appel.documents.map((document) => (
                        <article key={document.id} className="document-entry">
                          <div className="document-entry-copy">
                            <strong>{getDocumentLabel(document.kind)}</strong>
                            <span>{document.fileName}</span>
                            <small>
                              {formatBytes(document.sizeBytes)} octets · ajouté le{" "}
                              {formatDateTime(document.createdAt)}
                            </small>
                          </div>
                          <div className="document-entry-actions">
                            {document.kind === "source_pdf" ? (
                              <Link
                                href={`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`}
                                className="button button-secondary button-small"
                                target="_blank"
                              >
                                Prévisualiser
                              </Link>
                            ) : null}
                            {document.kind === "fiche_xml" ? (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                onClick={() => setActiveTab("fiche")}
                              >
                                Ouvrir la Fiche CDC
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={() => setActiveTab("overview")}
                            >
                              Remplacer
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="Aucun document indexé"
                      description="Importez un CDC pour créer le premier ensemble documentaire de cet appel d'offres."
                    />
                  )}
                </div>
              </section>

              <div className="responsive-card-grid">
                <PlaceholderPanel
                  title="Annexes"
                  description="Le support des annexes sera ajouté dès que le backend de stockage documentaire sera disponible."
                />
                <PlaceholderPanel
                  title="FCI futures"
                  description="Les documents FCI apparaîtront ici après validation de la Fiche CDC."
                />
              </div>
            </div>
          ) : null}

          {activeTab === "processing" ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>État du traitement</h3>
                    <p className="meta">
                      Vue métier du traitement, sans exposer les détails techniques du pipeline.
                    </p>
                  </div>
                </div>
                <div className="section-body stack">
                  <div className="responsive-card-grid">
                    <article className="workspace-card">
                      <span className="card-kicker">Statut</span>
                      <h3>{summary.processingStateLabel}</h3>
                      <p className="workspace-card-description">{summary.currentStep}</p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Démarrage</span>
                      <h3>{formatDateTime(latestJob?.startedAt ?? null)}</h3>
                      <p className="workspace-card-description">
                        Fin : {formatDateTime(latestJob?.finishedAt ?? null)}
                      </p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Durée</span>
                      <h3>
                        {formatDuration(latestJob?.startedAt ?? null, latestJob?.finishedAt ?? null)}
                      </h3>
                      <p className="workspace-card-description">
                        Étape métier : {summary.currentStep}
                      </p>
                    </article>
                    <article className="workspace-card">
                      <span className="card-kicker">Erreur</span>
                      <h3>{latestJob?.errorMessage ? "Attention requise" : "Aucune erreur"}</h3>
                      <p className="workspace-card-description">
                        {latestJob?.errorMessage ?? "Le dernier traitement ne signale pas d'anomalie."}
                      </p>
                    </article>
                  </div>

                  <AppelOffresAnalysisPanel
                    code={appel.code}
                    hasSourcePdf={appel.artifacts.hasSourcePdf}
                    ficheStatus={appel.ficheStatus?.status ?? null}
                    hasFicheXml={appel.artifacts.hasFicheXml}
                  />

                  <div className="actions">
                    <button type="button" className="button button-ghost" disabled>
                      Annuler · non supporté
                    </button>
                    <button type="button" className="button button-secondary" disabled>
                      Voir les détails techniques · admin
                    </button>
                  </div>
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
                      <h3>Fiche CDC</h3>
                      <p className="meta">
                        La relecture commerciale reste identique, intégrée dans le nouveau shell.
                      </p>
                    </div>
                  </div>
                  <div className="section-body stack">
                    <div className="responsive-card-grid">
                      <article className="workspace-card">
                        <span className="card-kicker">Statut</span>
                        <h3>{summary.ficheStatusLabel}</h3>
                        <p className="workspace-card-description">
                          Dernière mise à jour du dossier {formatDateTime(appel.updatedAt)}
                        </p>
                      </article>
                      <article className="workspace-card">
                        <span className="card-kicker">Validation</span>
                        <h3>
                          {appel.ficheStatus?.status === "validated"
                            ? "Validée"
                            : "En attente"}
                        </h3>
                        <p className="workspace-card-description">
                          Le commercial valide uniquement la Fiche CDC.
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
                description="Lancez d'abord l'analyse du CDC pour générer la Fiche CDC à relire."
                action={
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setActiveTab("processing")}
                  >
                    Aller au traitement
                  </button>
                }
              />
            )
          ) : null}

          {activeTab === "fci" ? (
            <div className="responsive-card-grid">
              <PlaceholderPanel
                title="FCI Commerciale"
                description="Disponible après validation de la Fiche CDC."
              />
              <PlaceholderPanel
                title="FCI Financière"
                description="Disponible après validation de la Fiche CDC."
              />
              <PlaceholderPanel
                title="FCI Technique / Opérations"
                description="Disponible après validation de la Fiche CDC."
              />
              <PlaceholderPanel
                title="FCI Stratégique"
                description="Disponible après validation de la Fiche CDC."
              />
              <PlaceholderPanel
                title="FCI Retour d'expérience"
                description="Disponible après validation de la Fiche CDC."
              />
            </div>
          ) : null}

          {activeTab === "knowledge" ? (
            <div className="responsive-card-grid">
              <PlaceholderPanel
                title="Projets similaires"
                description="Aucun rapprochement n'est encore disponible pour ce dossier."
              />
              <PlaceholderPanel
                title="CDC historiques"
                description="La consultation croisée des CDC historiques sera ajoutée plus tard."
              />
              <PlaceholderPanel
                title="Compétences et logiciels"
                description="Les suggestions de compétences, logiciels et profils seront proposées dans une prochaine étape."
              />
              <PlaceholderPanel
                title="Partenaires suggérés"
                description="Les recommandations de partenaires apparaîtront ici lorsque le module sera connecté."
              />
            </div>
          ) : null}

          {activeTab === "history" ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Historique du dossier</h3>
                    <p className="meta">
                      Événements applicatifs et traces de traitement réellement disponibles.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  {appel.auditLogs.length || appel.processingJobs.length ? (
                    <div className="timeline-list">
                      {appel.auditLogs.map((entry) => (
                        <article key={`audit-${entry.id}`} className="timeline-item">
                          <div className="timeline-dot" />
                          <div className="timeline-content">
                            <strong>{entry.action}</strong>
                            <span>{formatDateTime(entry.createdAt)}</span>
                          </div>
                        </article>
                      ))}
                      {appel.processingJobs.map((job) => (
                        <article key={`job-${job.id}`} className="timeline-item">
                          <div className="timeline-dot secondary" />
                          <div className="timeline-content">
                            <strong>{job.jobType}</strong>
                            <span>
                              {formatDateTime(job.startedAt)}
                              {job.finishedAt ? ` · ${formatDateTime(job.finishedAt)}` : ""}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      compact
                      title="Historique indisponible"
                      description="Les événements s'afficheront ici à mesure que l'appel d'offres évoluera."
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
