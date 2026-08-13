"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActivityFeed } from "@/components/activity-feed.tsx";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FileTextIcon,
  UploadIcon
} from "@/components/app-icons.tsx";
import { AppelOffresAnalysisPanel } from "@/components/appel-offres-analysis-panel";
import { DgDecisionCenter } from "@/components/dg-decision-center.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { FciWorkspace } from "@/components/fci/fci-workspace.tsx";
import { GoNoGoPanel } from "@/components/go-no-go-panel.tsx";
import { GoNoGoReportBuilder } from "@/components/go-no-go-report-builder.tsx";
import { OwnershipMenu } from "@/components/ownership-menu.tsx";
import { ProcessingTimeline } from "@/components/processing-timeline.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { TenderStageStrip } from "@/components/tender-stage-strip.tsx";
import { TenderOverviewStatus } from "@/components/tender-overview-status.tsx";
import { WorkspaceHeader } from "@/components/workspace-header.tsx";
import { WorkspaceTabs } from "@/components/workspace-tabs.tsx";
import { getPdfFileSelectionError } from "@/lib/appels-offres/create-form.ts";
import {
  getAppelOffresWorkspaceTabs,
  isDecisionCenterRole
} from "@/lib/appels-offres/dossier-experience.ts";
import type { FciDetail, FciSetOverallStatus } from "@/lib/appels-offres/fci/types.ts";
import type { GoNoGoDecisionRecord } from "@/lib/appels-offres/go-no-go/types.ts";
import type { TenderWorkflowStateView } from "@/lib/appels-offres/workflow/service.ts";
import { deriveTenderStage } from "@/lib/appels-offres/tender-stage.ts";
import { getFciModuleForRole } from "@/lib/auth/rbac.ts";
import type { UserRole } from "@/lib/auth/rbac.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";
import {
  buildProcessingTimeline,
  buildWorkspaceActions,
  buildWorkspaceActivityFeed,
  buildWorkspaceFailureSummary,
  buildWorkspaceIdentity,
  type WorkspaceAction,
  type WorkspaceTabKey
} from "@/lib/appels-offres/workspace.ts";
import type { AppelOffresDetail, DocumentRecord } from "@/lib/appels-offres/types.ts";
import { FicheEditor } from "./fiche-editor.tsx";

type WorkspaceFlash = "created-processing" | "launch-failed" | "analysis-started";
type ReviewWorkflowState = "saved" | "validated" | null;
type ReplacementSubmitState = "idle" | "submitting";

type FciTabModuleCode = "A" | "B" | "C" | "D";

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

function formatDocumentDateTime(value: string | null) {
  if (!value) {
    return "Date indisponible";
  }

  const date = new Date(value);
  return `${date.toLocaleDateString("fr-FR")} a ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function formatDocumentSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "Taille indisponible";
  }

  if (sizeBytes < 1024 * 1024) {
    return `${new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: 0
    }).format(sizeBytes / 1024)} Ko`;
  }

  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(sizeBytes / (1024 * 1024))} Mo`;
}

function getDocumentTypeLabel(kind: DocumentRecord["kind"]) {
  switch (kind) {
    case "source_pdf":
      return "PDF";
    case "fiche_markdown":
      return "Markdown";
    case "fiche_xml":
      return "XML";
    default:
      return "Document";
  }
}

function getBusinessFicheStatus({
  ficheReady,
  ficheDocument,
  ficheStatus,
  isRunning,
  hasFailure
}: {
  ficheReady: boolean;
  ficheDocument: DocumentRecord | null;
  ficheStatus: AppelOffresDetail["ficheStatus"];
  isRunning: boolean;
  hasFailure: boolean;
}) {
  if (ficheReady) {
    const isValidated = ficheStatus?.status === "validated";
    const statusDate = ficheStatus?.validatedAt ?? ficheStatus?.modifiedAt ?? ficheDocument?.createdAt;

    return {
      label: isValidated ? "Validee" : "Disponible",
      tone: "success" as BadgeTone,
      title: "Fiche CDC",
      message: statusDate
        ? `${isValidated ? "Mise a jour" : "Generee"} le ${formatDocumentDateTime(statusDate)}`
        : isValidated
          ? "La fiche a ete validee et reste consultable."
          : "La fiche est disponible pour consultation.",
      icon: CheckCircleIcon
    };
  }

  if (isRunning) {
    return {
      label: "En cours de generation",
      tone: "ai" as BadgeTone,
      title: "Fiche CDC",
      message: "La fiche sera disponible a la fin de l'analyse.",
      icon: ClockIcon
    };
  }

  if (hasFailure) {
    return {
      label: "A verifier",
      tone: "warning" as BadgeTone,
      title: "Fiche CDC",
      message: "Le document n'a pas pu etre traite. Reessayez ou contactez l'administrateur.",
      icon: AlertIcon
    };
  }

  return {
    label: "En attente de generation",
    tone: "warning" as BadgeTone,
    title: "Fiche CDC",
    message: "Lancez l'analyse pour generer la fiche.",
    icon: ClockIcon
  };
}

function buildAppelOffresUpdatePayload(
  appel: AppelOffresDetail,
  file: File | null
) {
  const payload = new FormData();
  payload.append("code", appel.code);
  payload.append("title", appel.title);
  payload.append("reference", appel.reference);
  payload.append("buyer", appel.buyer);
  payload.append("country", appel.country);
  payload.append("dueDate", appel.dueDate ?? "");
  payload.append("notes", appel.notes);
  payload.append("priorite", appel.priorite);
  payload.append("responsable_commercial", appel.responsableCommercial);

  if (file) {
    payload.append("file", file);
  }

  return payload;
}

function hasReviewableFiche(appel: AppelOffresDetail) {
  return (
    appel.artifacts.hasFicheXml ||
    appel.ficheStatus?.status === "draft" ||
    appel.ficheStatus?.status === "validated"
  );
}

function isProcessingRunning(appel: AppelOffresDetail) {
  const latestJob = appel.processingJobs[0] ?? null;
  return Boolean(
    appel.ficheStatus?.status === "processing" ||
      (latestJob && ["created", "queued", "running", "retrying"].includes(latestJob.status))
  );
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
          "Le dossier a ete cree, mais le lancement de l'analyse a echoue. Vous pouvez relancer l'analyse depuis l'aperçu du dossier."
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

// Presentation-only refinement of the FCI_IN_PROGRESS next-action label for
// the Overview: same canonical stage/href, just a message tailored to what
// this particular user is waiting on. Not used anywhere else, so it can't
// create a second notion of "current state" - the stage itself is untouched.
function getFciInProgressActionLabel(
  fciDetail: FciDetail | null,
  role: UserRole | undefined
): string | undefined {
  if (!fciDetail) {
    return undefined;
  }

  const moduleStatus = (code: "A" | "B" | "C" | "D") =>
    fciDetail.modules.find((module) => module.moduleCode === code)?.status;
  const ownModule = role ? getFciModuleForRole(role) : null;

  if (ownModule === "A" || ownModule === "B" || ownModule === "C" || ownModule === "D") {
    if (moduleStatus(ownModule) !== "validated") {
      return "Compléter ma FCI";
    }
  }

  const pending: string[] = [];
  if (moduleStatus("B") !== "validated") {
    pending.push("la Finance");
  }
  if (moduleStatus("C") !== "validated") {
    pending.push("les Opérations");
  }
  if (moduleStatus("D") !== "validated") {
    pending.push("la Direction Générale");
  }

  if (pending.length === 1) {
    return `En attente de ${pending[0]}`;
  }
  if (pending.length > 1) {
    return `En attente de ${pending.join(" et de ")}`;
  }

  return undefined;
}

export function AppelOffresWorkspace({
  appel,
  initialTab = "overview",
  flash,
  fciStatus = null,
  fciDetail = null,
  workflow = null,
  decision = null,
  currentUserRole
}: {
  appel: AppelOffresDetail;
  initialTab?: WorkspaceTabKey;
  flash?: WorkspaceFlash;
  fciStatus?: FciSetOverallStatus | null;
  fciDetail?: FciDetail | null;
  workflow?: TenderWorkflowStateView | null;
  decision?: GoNoGoDecisionRecord | null;
  currentUserRole?: UserRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>(initialTab);
  const [isTechnicalDetailsOpen, setIsTechnicalDetailsOpen] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewWorkflowState>(null);
  const [isPending, startTransition] = useTransition();
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [replacementSuccess, setReplacementSuccess] = useState<string | null>(null);
  const [replacementSubmitState, setReplacementSubmitState] =
    useState<ReplacementSubmitState>("idle");
  const replacementInputRef = useRef<HTMLInputElement | null>(null);
  const stage = deriveTenderStage({ detail: appel, fciDetail, workflow, decision });
  const identity = buildWorkspaceIdentity(appel);
  const timeline = buildProcessingTimeline(appel);
  const activity = buildWorkspaceActivityFeed(appel);
  const failureSummary = buildWorkspaceFailureSummary(appel);
  const flashContent = getFlashContent(flash);
  const latestJob = appel.processingJobs[0] ?? null;
  const actions = buildWorkspaceActions(appel);
  const isRunning = isProcessingRunning(appel);
  const sourcePdfDocument = useMemo(
    () => appel.documents.find((document) => document.kind === "source_pdf") ?? null,
    [appel.documents]
  );
  const ficheDocument = useMemo(
    () => appel.documents.find((document) => document.kind === "fiche_xml") ?? null,
    [appel.documents]
  );
  const ficheReady = hasReviewableFiche(appel);
  const showAnalysisPanel =
    !isRunning &&
    (!ficheReady ||
      Boolean(failureSummary?.retryAvailable || actions.primary?.kind === "launch-analysis"));
  const overviewActivity = useMemo(() => activity.slice(0, 3), [activity]);
  const ficheDocumentStatus = useMemo(
    () =>
      getBusinessFicheStatus({
        ficheReady,
        ficheDocument,
        ficheStatus: appel.ficheStatus,
        isRunning,
        hasFailure: Boolean(failureSummary)
      }),
    [appel.ficheStatus, failureSummary, ficheDocument, ficheReady, isRunning]
  );
  const FicheDocumentIcon = ficheDocumentStatus.icon;
  const visibleBusinessDocumentsCount = (sourcePdfDocument ? 1 : 0) + (ficheReady ? 1 : 0);
  const decisionCenterRole = isDecisionCenterRole(currentUserRole);
  const commercialCoordinatorRole = currentUserRole === "COMMERCIAL";
  const visibleTabs = useMemo(
    () => getAppelOffresWorkspaceTabs(currentUserRole),
    [currentUserRole]
  );

  const tabConfigs = useMemo(
    () =>
      visibleTabs.map((tab) => ({
        key: tab.key,
        label: tab.label,
        count:
          tab.countKey === "documents"
            ? visibleBusinessDocumentsCount
            : tab.countKey === "history"
              ? activity.length
              : undefined
      })),
    [activity.length, visibleBusinessDocumentsCount, visibleTabs]
  );
  const replacementSelectedFile = replacementFile ? (
    <div className="upload-selected-file compact">
      <div className="upload-selected-leading">
        <span className="upload-selected-icon" aria-hidden="true">
          <FileTextIcon className="upload-icon" />
        </span>
        <div>
          <strong>{replacementFile.name}</strong>
          <span>{formatDocumentSize(replacementFile.size)}</span>
        </div>
      </div>
      <div className="upload-selected-actions">
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => replacementInputRef.current?.click()}
          disabled={replacementSubmitState === "submitting"}
        >
          Remplacer
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => applyReplacementFile(null)}
          disabled={replacementSubmitState === "submitting"}
        >
          Retirer
        </button>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setReviewState(null);
  }, [appel.code]);

  useEffect(() => {
    setReplacementFile(null);
    setReplacementError(null);
    setReplacementSuccess(null);
    if (replacementInputRef.current) {
      replacementInputRef.current.value = "";
    }
  }, [appel.code]);

  useEffect(() => {
    setIsTechnicalDetailsOpen(false);
  }, [appel.code, latestJob?.publicId]);

  function updateView(nextTab: WorkspaceTabKey) {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    params.delete("flash");
    if (nextTab !== "fci") {
      params.delete("fciModule");
    }
    const basePath = `/appels-offres/${encodeURIComponent(appel.code)}/${toViewParam(nextTab)}`;
    router.replace(params.size ? `${basePath}?${params.toString()}` : basePath, { scroll: false });
  }

  function openFciModule(moduleCode: FciTabModuleCode) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    params.set("fciModule", moduleCode);
    params.delete("flash");
    router.replace(`/appels-offres/${encodeURIComponent(appel.code)}/fci?${params.toString()}`, { scroll: false });
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
        updateView("overview");
        router.refresh();
        return;
      }

      if (response.status === 409 && body.requiresConfirmation) {
        updateView("overview");
        setWorkspaceMessage(
          body.error ?? "La relance doit etre confirmee depuis la section Analyse."
        );
        return;
      }

      updateView("overview");
      setWorkspaceMessage(body.error ?? "Le lancement de l'analyse a echoue.");
    });
  }

  function applyReplacementFile(nextFile: File | null) {
    if (!nextFile) {
      setReplacementFile(null);
      setReplacementError(null);
      if (replacementInputRef.current) {
        replacementInputRef.current.value = "";
      }
      return;
    }

    const fileError = getPdfFileSelectionError({
      name: nextFile.name,
      type: nextFile.type,
      size: nextFile.size
    });

    if (fileError) {
      setReplacementFile(null);
      setReplacementError(fileError);
      if (replacementInputRef.current) {
        replacementInputRef.current.value = "";
      }
      return;
    }

    setReplacementFile(nextFile);
    setReplacementError(null);
    setReplacementSuccess(null);
  }

  async function handleReplaceSourcePdf() {
    if (!replacementFile || replacementSubmitState === "submitting") {
      return;
    }

    setReplacementError(null);
    setReplacementSuccess(null);
    setReplacementSubmitState("submitting");

    try {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(appel.code)}`, {
        method: "PUT",
        body: buildAppelOffresUpdatePayload(appel, replacementFile)
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Le remplacement du CDC a echoue.");
      }

      setReplacementSuccess("Le CDC a ete mis a jour.");
      setReplacementFile(null);
      if (replacementInputRef.current) {
        replacementInputRef.current.value = "";
      }
      router.refresh();
    } catch (error) {
      setReplacementError(
        error instanceof Error ? error.message : "Le remplacement du CDC a echoue."
      );
    } finally {
      setReplacementSubmitState("idle");
    }
  }

  function handleAction(action: WorkspaceAction) {
    if (action.disabled) {
      return;
    }

    switch (action.kind) {
      case "launch-analysis":
        void handleLaunchAnalysis();
        break;
      case "open-processing":
        updateView("overview");
        break;
      case "open-fiche":
      case "validate-fiche":
        updateView("fiche");
        break;
      case "download-cdc":
        window.open(
          `/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`,
          "_blank",
          "noopener,noreferrer"
        );
        break;
      case "edit-overview":
        updateView("fiche");
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
    <div className="stack workspace-stack">
      {!decisionCenterRole || activeTab !== "go-no-go" ? (
        <WorkspaceHeader
          backHref="/appels-offres"
          code={appel.code}
          identity={identity}
          statusLabel={stage.label}
          statusTone={stage.tone}
          deadlineLabel={formatDate(appel.dueDate)}
          secondaryActions={decisionCenterRole ? [] : actions.secondary}
          secondaryLinks={
            decisionCenterRole
              ? [
                  {
                    label: "Documents du dossier",
                    href: `/appels-offres/${encodeURIComponent(appel.code)}?view=documents`
                  }
                ]
              : [
                  {
                    label: "Analyse des logiciels",
                    href: `/appels-offres/${encodeURIComponent(appel.code)}/analyse/logiciels`
                  }
                ]
          }
          onAction={handleAction}
        />
      ) : null}

      <section className="tabs-card workspace-tabs-card">
        {flashContent ? (
          <div className={flashContent.tone === "warning" ? "callout warning" : "callout info"}>
            {flashContent.message}
          </div>
        ) : null}
        {workspaceMessage ? <div className="callout warning">{workspaceMessage}</div> : null}

        <WorkspaceTabs
          tabs={tabConfigs}
          activeKey={activeTab}
          onSelect={(key) => updateView(key as WorkspaceTabKey)}
        />

        <div className="tabs-panel workspace-tabs-panel">
          {activeTab === "overview" ? (
            <div className="stack tender-overview">
              <section className="tender-overview-summary">
                <TenderStageStrip steps={stage.progressSteps} />

                {stage.blockingReason ? (
                  <div className={`callout ${stage.stage === "CDC_PROCESSING" ? "warning" : "info"}`}>
                    {stage.blockingReason}
                  </div>
                ) : null}

                {!isRunning && !(stage.stage === "CDC_PROCESSING" && failureSummary) ? (
                  <TenderOverviewStatus
                    stage={stage}
                    decision={decision}
                    nextActionLabelOverride={
                      stage.stage === "FCI_IN_PROGRESS"
                        ? getFciInProgressActionLabel(fciDetail, currentUserRole)
                        : undefined
                    }
                    onNavigate={(href) => router.push(href)}
                  />
                ) : null}
              </section>

              {isRunning ? (
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <h3>Analyse du CDC en cours</h3>
                      <p className="meta">
                        La Fiche CDC sera generee automatiquement a la fin de l'analyse.
                      </p>
                    </div>
                  </div>
                  <div className="section-body stack">
                    <ProcessingTimeline steps={timeline} />
                    {(latestJob || failureSummary?.technicalDetails) ? (
                      <details
                        className="technical-details"
                        open={isTechnicalDetailsOpen}
                        onToggle={(event) => {
                          setIsTechnicalDetailsOpen(event.currentTarget.open);
                        }}
                      >
                        <summary className="markdown-summary">Details techniques</summary>
                        <div className="technical-details-grid">
                          {latestJob?.publicId ? <span>Job ID : {latestJob.publicId}</span> : null}
                          {latestJob?.executionId ? (
                            <span>Execution ID : {latestJob.executionId}</span>
                          ) : null}
                          {latestJob?.correlationId ? (
                            <span>Correlation ID : {latestJob.correlationId}</span>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </section>
              ) : stage.stage === "CDC_PROCESSING" && failureSummary ? (
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <h3>L'analyse n'a pas pu etre terminee</h3>
                      <p className="meta">{failureSummary.message}</p>
                    </div>
                  </div>
                  <div className="section-body stack">
                    {showAnalysisPanel ? (
                      <AppelOffresAnalysisPanel
                        code={appel.code}
                        hasSourcePdf={appel.artifacts.hasSourcePdf}
                        ficheStatus={appel.ficheStatus?.status ?? null}
                        hasFicheXml={appel.artifacts.hasFicheXml}
                        isRetryState
                      />
                    ) : null}
                    {failureSummary.technicalDetails ? (
                      <details
                        className="technical-details"
                        open={isTechnicalDetailsOpen}
                        onToggle={(event) => setIsTechnicalDetailsOpen(event.currentTarget.open)}
                      >
                        <summary className="markdown-summary">Details techniques</summary>
                        <div className="technical-details-grid">
                          <span>Detail brut : {failureSummary.technicalDetails}</span>
                        </div>
                      </details>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Informations clés</h3>
                  </div>
                </div>
                <div className="section-body">
                  <dl className="tender-key-info">
                    <div className="tender-key-info-row">
                      <dt>Client</dt>
                      <dd>{identity.clientLabel}</dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>Pays</dt>
                      <dd>{identity.countryLabel}</dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>Responsable commercial</dt>
                      <dd>
                        {commercialCoordinatorRole ? (
                          <OwnershipMenu code={appel.code} />
                        ) : (
                          identity.responsibleLabel
                        )}
                      </dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>Date limite</dt>
                      <dd>{appel.dueDate ? formatDate(appel.dueDate) : "Non renseignée"}</dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>Priorité</dt>
                      <dd>{identity.priorityLabel}</dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>Référence</dt>
                      <dd>{appel.reference || "Non renseignée"}</dd>
                    </div>
                    <div className="tender-key-info-row">
                      <dt>CDC source</dt>
                      <dd>
                        {sourcePdfDocument?.fileName ??
                          (appel.artifacts.hasSourcePdf ? "Disponible" : "Non renseigné")}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Activite recente</h3>
                    <p className="meta">Les trois derniers evenements utiles au suivi du dossier.</p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => updateView("history")}
                  >
                    Voir tout l'historique
                  </button>
                </div>
                <div className="section-body">
                  {overviewActivity.length ? (
                    <ActivityFeed items={overviewActivity} variant="compact" />
                  ) : (
                    <EmptyState
                      compact
                      title="Aucune activite recente"
                      description="Les prochains evenements utiles au suivi apparaitront ici."
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
                    <h3>CDC original</h3>
                    <p className="meta">Document original transmis pour l'appel d'offres.</p>
                  </div>
                </div>
                <div className="section-body">
                  {sourcePdfDocument ? (
                    <article className="document-row compact workspace-document-row">
                      <div className="workspace-document-leading">
                        <div className="workspace-document-icon" aria-hidden="true">
                          <FileTextIcon className="workspace-document-icon-svg" />
                        </div>
                        <div className="workspace-document-copy">
                          <div className="workspace-document-title-row">
                            <strong>CDC original</strong>
                            <StatusBadge label="Disponible" tone="success" />
                          </div>
                          <span className="workspace-document-filename">
                            {sourcePdfDocument.fileName}
                          </span>
                          <small>
                            {getDocumentTypeLabel(sourcePdfDocument.kind)} ·{" "}
                            {formatDocumentSize(sourcePdfDocument.sizeBytes)} ·{" "}
                            {formatDocumentDateTime(sourcePdfDocument.createdAt)}
                          </small>
                        </div>
                      </div>
                      <div className="document-entry-actions">
                        <Link
                          href={`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`}
                          className="button button-secondary button-small"
                          target="_blank"
                        >
                          <ArrowRightIcon className="button-icon" />
                          Ouvrir
                        </Link>
                        <Link
                          href={`/api/appels-offres/${encodeURIComponent(appel.code)}/pdf`}
                          className="button button-ghost button-small"
                          download
                        >
                          Telecharger
                        </Link>
                      </div>
                    </article>
                  ) : (
                    <EmptyState
                      compact
                      title="CDC original indisponible"
                      description="Aucun document source n'est actuellement disponible pour cet appel d'offres."
                    />
                  )}
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Fiche CDC</h3>
                    <p className="meta">
                      Document de synthese genere automatiquement a partir du CDC pour la revue commerciale.
                    </p>
                    <p className="meta">
                      Le commercial peut ensuite corriger, completer et valider les informations.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  <article className="document-row compact workspace-document-row">
                    <div className="workspace-document-leading">
                      <div
                        className={`workspace-document-icon is-${ficheDocumentStatus.tone}`}
                        aria-hidden="true"
                      >
                        <FicheDocumentIcon className="workspace-document-icon-svg" />
                      </div>
                      <div className="workspace-document-copy">
                        <div className="workspace-document-title-row">
                          <strong>{ficheDocumentStatus.title}</strong>
                          <StatusBadge
                            label={ficheDocumentStatus.label}
                            tone={ficheDocumentStatus.tone}
                          />
                        </div>
                        <span className="workspace-document-filename">
                          {ficheReady ? "Fiche CDC generee" : "Fiche CDC"}
                        </span>
                        <small>{ficheDocumentStatus.message}</small>
                      </div>
                    </div>
                    <div className="document-entry-actions">
                      {ficheReady ? (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => updateView("fiche")}
                        >
                          <ArrowRightIcon className="button-icon" />
                          {appel.ficheStatus?.status === "validated" ? "Consulter" : "Ouvrir"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                </div>
              </section>

              {!decisionCenterRole ? (
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <h3>Mettre a jour le CDC</h3>
                      <p className="meta">
                        Importez un nouveau PDF si le document source doit etre remplace.
                      </p>
                    </div>
                  </div>
                  <div className="section-body">
                    <div className="workspace-document-version-card">
                    <div className="workspace-document-leading">
                      <div className="workspace-document-icon is-upload" aria-hidden="true">
                        <UploadIcon className="workspace-document-icon-svg" />
                      </div>
                      <div className="workspace-document-version-copy">
                        <span className="card-kicker">Document actuellement utilise</span>
                        <strong>
                          {sourcePdfDocument?.fileName ?? "Aucun CDC original disponible"}
                        </strong>
                        <span className="meta">
                          {sourcePdfDocument
                            ? `${formatDocumentSize(sourcePdfDocument.sizeBytes)} · ${formatDocumentDateTime(sourcePdfDocument.createdAt)}`
                            : "Le prochain CDC importe apparaitra ici."}
                        </span>
                      </div>
                    </div>
                    <div className="workspace-document-version-actions">
                      <input
                        ref={replacementInputRef}
                        type="file"
                        accept="application/pdf,.pdf"
                        className="sr-only"
                        disabled={replacementSubmitState === "submitting"}
                        onChange={(event) => applyReplacementFile(event.target.files?.[0] ?? null)}
                      />
                      <div className="document-entry-actions">
                        <button
                          type="button"
                          className="button button-ghost"
                          onClick={() => replacementInputRef.current?.click()}
                          disabled={replacementSubmitState === "submitting"}
                        >
                          Choisir un PDF
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void handleReplaceSourcePdf()}
                          disabled={!replacementFile || replacementSubmitState === "submitting"}
                        >
                          <UploadIcon className="button-icon" />
                          {replacementSubmitState === "submitting"
                            ? "Remplacement..."
                            : "Remplacer le CDC"}
                        </button>
                      </div>
                    </div>
                    </div>
                    {replacementSelectedFile}
                    {replacementFile ? (
                      <div className="callout warning">
                        Remplacer le CDC relance une nouvelle analyse et régénère la Fiche CDC. Les FCI déjà
                        complétées ou validées devront être vérifiées à nouveau avant de poursuivre.
                      </div>
                    ) : null}
                    {replacementError ? <div className="callout warning">{replacementError}</div> : null}
                    {replacementSuccess ? <div className="callout info">{replacementSuccess}</div> : null}
                  </div>
                </section>
              ) : (
                <section className="section-card">
                  <div className="section-header">
                    <div>
                      <h3>Acces documentaire</h3>
                      <p className="meta">
                        Les documents du dossier restent accessibles en lecture seule pour la Direction generale.
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          ) : null}

          {activeTab === "fiche" ? (
            <FicheEditor
              code={appel.code}
              appel={appel}
              readOnly={currentUserRole !== "COMMERCIAL"}
              onReviewStateChange={setReviewState}
            />
          ) : null}

          {activeTab === "fci" ? (
            <FciWorkspace
              code={appel.code}
              ficheValidated={appel.ficheStatus?.status === "validated"}
              currentUserRole={currentUserRole}
              onOpenFiche={() => updateView("fiche")}
            />
          ) : null}

          {activeTab === "go-no-go" ? (
            decisionCenterRole ? (
              <DgDecisionCenter
                appel={appel}
                fciStatus={fciStatus}
                onOpenDocuments={() => updateView("documents")}
                onOpenHistory={() => updateView("history")}
              />
            ) : commercialCoordinatorRole ? (
              <GoNoGoReportBuilder
                code={appel.code}
                onOpenDocuments={() => updateView("documents")}
                onOpenFciModule={openFciModule}
              />
            ) : (
              <GoNoGoPanel
                code={appel.code}
                onOpenFci={() => updateView("fci")}
                onOpenFciModule={openFciModule}
              />
            )
          ) : null}

          {activeTab === "history" ? (
            <section className="section-card">
              <div className="section-header">
                <div>
                  <h3>Historique</h3>
                  <p className="meta">
                    Les evenements importants du dossier, presentes dans un langage metier.
                  </p>
                </div>
              </div>
              <div className="section-body">
                {activity.length ? (
                  <ActivityFeed items={activity} variant="history" />
                ) : (
                  <EmptyState
                    compact
                    title="Aucun evenement"
                    description="Les principales etapes du dossier apparaitront ici."
                  />
                )}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
