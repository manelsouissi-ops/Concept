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
import { CommercialWorkflowPanel } from "@/components/commercial-workflow-panel.tsx";
import { DgDecisionCenter } from "@/components/dg-decision-center.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { FciWorkspace } from "@/components/fci/fci-workspace.tsx";
import { GoNoGoPanel } from "@/components/go-no-go-panel.tsx";
import { GoNoGoReportBuilder } from "@/components/go-no-go-report-builder.tsx";
import { ProcessingTimeline } from "@/components/processing-timeline.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { WorkspaceHeader } from "@/components/workspace-header.tsx";
import { WorkspaceTabs } from "@/components/workspace-tabs.tsx";
import { buildDashboardStatusDisplay } from "@/lib/appels-offres/dashboard-status.ts";
import { getPdfFileSelectionError } from "@/lib/appels-offres/create-form.ts";
import {
  getAppelOffresWorkspaceTabs,
  isDecisionCenterRole
} from "@/lib/appels-offres/dossier-experience.ts";
import type { FciSetOverallStatus } from "@/lib/appels-offres/fci/types.ts";
import type { UserRole } from "@/lib/auth/rbac.ts";
import {
  buildAppelOffresSummary,
  type BadgeTone
} from "@/lib/appels-offres/presentation.ts";
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

type FciTabModuleCode = "A" | "B" | "C";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR");
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

function isMissingValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "non renseigne" || normalized === "non renseignee";
}

function withDashFallback(value: string) {
  return isMissingValue(value) ? "—" : value;
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

function formatDurationOrElapsed(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) {
    return "Non disponible";
  }

  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const start = new Date(startedAt).getTime();
  const durationMs = end - start;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "Non disponible";
  }

  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
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
          "Le dossier a ete cree, mais le lancement de l'analyse a echoue. Vous pouvez relancer l'analyse depuis l'onglet FCI."
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

function getActionButtonClassName(action: WorkspaceAction) {
  if (action.kind === "archive") {
    return "button button-danger-ghost";
  }

  if (action.tone === "ai") {
    return "button button-ai";
  }

  if (action.tone === "primary") {
    return "button button-primary";
  }

  if (action.tone === "ghost") {
    return "button button-ghost";
  }

  return "button button-secondary";
}

function buildAnalysisGuidance({
  appel,
  actions,
  isRunning,
  failureSummary,
  reviewState
}: {
  appel: AppelOffresDetail;
  actions: ReturnType<typeof buildWorkspaceActions>;
  isRunning: boolean;
  failureSummary: ReturnType<typeof buildWorkspaceFailureSummary>;
  reviewState: ReviewWorkflowState;
}) {
  const ficheReady = hasReviewableFiche(appel);
  const ficheValidated = appel.ficheStatus?.status === "validated" || reviewState === "validated";

  if (isRunning) {
    return {
      title: "Analyse du CDC en cours",
      description: "La Fiche CDC sera generee automatiquement a la fin de l'analyse.",
      tone: "ai" as const,
      primaryAction: null
    };
  }

  if (reviewState === "saved" && appel.ficheStatus?.status === "draft") {
    return {
      title: "Modifications enregistrees",
      description: "La fiche est prete pour validation finale.",
      tone: "success" as const,
      primaryAction: {
        kind: "validate-fiche",
        label: "Valider la Fiche CDC",
        tone: "primary"
      } satisfies WorkspaceAction
    };
  }

  if (ficheValidated) {
    return {
      title: "Fiche CDC validee",
      description: "La fiche reste consultable et ne demande plus d'action commerciale.",
      tone: "success" as const,
      primaryAction: {
        kind: "open-fiche",
        label: "Consulter la Fiche CDC",
        tone: "primary"
      } satisfies WorkspaceAction
    };
  }

  if (ficheReady) {
    return {
      title: "Fiche CDC generee par l'IA",
      description:
        "Verifiez les informations extraites, corrigez ou completez les champs si necessaire, puis validez la fiche.",
      tone: "default" as const,
      primaryAction: {
        kind: "open-fiche",
        label: "Reviser la Fiche CDC",
        tone: "primary"
      } satisfies WorkspaceAction
    };
  }

  if (failureSummary?.retryAvailable && actions.primary?.kind === "launch-analysis") {
    return {
      title: "Analyse du CDC interrompue",
      description: failureSummary.message,
      tone: "warning" as const,
      primaryAction: actions.primary
    };
  }

  if (actions.primary?.kind === "launch-analysis") {
    return {
      title: "CDC pret pour analyse",
      description: "Le dossier est pret. Lancez l'analyse pour generer automatiquement la Fiche CDC.",
      tone: "default" as const,
      primaryAction: actions.primary
    };
  }

  return {
    title: "Dossier cree",
    description: "Completez les informations du dossier et preparez la revue de la Fiche CDC.",
    tone: "default" as const,
    primaryAction: null
  };
}

function getOverviewPrimaryAction({
  appel,
  actions,
  isRunning,
  reviewState
}: {
  appel: AppelOffresDetail;
  actions: ReturnType<typeof buildWorkspaceActions>;
  isRunning: boolean;
  reviewState: ReviewWorkflowState;
}) {
  if (isRunning) {
    return {
      action: {
        kind: "open-processing",
        label: "Suivre l'analyse",
        tone: "secondary"
      } satisfies WorkspaceAction,
      description: "Suivez l'avancement du traitement et les etapes en cours."
    };
  }

  if (reviewState === "saved" && appel.ficheStatus?.status === "draft") {
    return {
      action: {
        kind: "validate-fiche",
        label: "Valider la Fiche CDC",
        tone: "primary"
      } satisfies WorkspaceAction,
      description: "Finalisez la revue commerciale de la fiche avant la suite du processus."
    };
  }

  if (actions.primary) {
    return {
      action:
        actions.primary.kind === "edit-overview"
          ? {
              ...actions.primary,
              label: "Modifier la Fiche CDC"
            }
          : actions.primary,
      description:
        actions.primary.kind === "launch-analysis"
          ? "Lancez ou relancez l'analyse pour generer automatiquement la Fiche CDC."
          : actions.primary.kind === "open-fiche"
            ? appel.ficheStatus?.status === "validated"
              ? "Consultez la fiche finalisee pour preparer la suite."
              : "Ouvrez la fiche generee par l'IA pour la relire et la completer."
            : "Mettez a jour les informations du dossier et la Fiche CDC dans un seul espace."
    };
  }

  return {
    action: {
      kind: "edit-overview",
      label: "Modifier la Fiche CDC",
      tone: "secondary"
    } satisfies WorkspaceAction,
    description: "Renseignez les informations du dossier dans la Fiche CDC, puis poursuivez l'analyse."
  };
}

function getOverviewProgressNote(failureSummary: ReturnType<typeof buildWorkspaceFailureSummary>) {
  if (!failureSummary?.failedStep) {
    return null;
  }

  return `Analyse interrompue a l'etape ${failureSummary.failedStep}.`;
}

export function AppelOffresWorkspace({
  appel,
  initialTab = "overview",
  flash,
  fciStatus = null,
  currentUserRole
}: {
  appel: AppelOffresDetail;
  initialTab?: WorkspaceTabKey;
  flash?: WorkspaceFlash;
  fciStatus?: FciSetOverallStatus | null;
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
  const summary = buildAppelOffresSummary(appel);
  const statusDisplay = buildDashboardStatusDisplay(summary, fciStatus);
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
  const analysisGuidance = buildAnalysisGuidance({
    appel,
    actions,
    isRunning,
    failureSummary,
    reviewState
  });
  const showAnalysisPanel =
    !isRunning &&
    (!ficheReady ||
      Boolean(failureSummary?.retryAvailable || actions.primary?.kind === "launch-analysis"));
  const overviewPrimary = getOverviewPrimaryAction({
    appel,
    actions,
    isRunning,
    reviewState
  });
  const overviewProgressCompleted = timeline.filter((step) => step.state === "complete").length;
  const overviewProgressPercent =
    timeline.length > 0 ? Math.round((overviewProgressCompleted / timeline.length) * 100) : 0;
  const overviewProgressNote = getOverviewProgressNote(failureSummary);
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
    params.set("view", toViewParam(nextTab));
    params.delete("flash");
    if (nextTab !== "fci") {
      params.delete("fciModule");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openFciModule(moduleCode: FciTabModuleCode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "fci");
    params.set("fciModule", moduleCode);
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
        updateView("fci");
        router.refresh();
        return;
      }

      if (response.status === 409 && body.requiresConfirmation) {
        updateView("fci");
        setWorkspaceMessage(
          body.error ?? "La relance doit etre confirmee depuis la section Analyse."
        );
        return;
      }

      updateView("fci");
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
        updateView("fci");
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
          statusLabel={statusDisplay.label}
          statusTone={statusDisplay.tone}
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
          {activeTab === "overview" && !decisionCenterRole ? (
            <div className="stack">
              {commercialCoordinatorRole ? (
                <CommercialWorkflowPanel
                  code={appel.code}
                  onOpenFci={() => updateView("fci")}
                  onOpenFciModule={openFciModule}
                  onOpenGoNoGo={() => updateView("go-no-go")}
                />
              ) : null}

              <div className="workspace-primary-grid">
                <article className="workspace-card compact">
                  <span className="card-kicker">Prochaine action</span>
                  <h3>{overviewPrimary.action.label}</h3>
                  <p className="workspace-card-description">{overviewPrimary.description}</p>
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className={getActionButtonClassName(overviewPrimary.action)}
                      onClick={() => handleAction(overviewPrimary.action)}
                    >
                      {overviewPrimary.action.label}
                    </button>
                  </div>
                </article>
                <article className="workspace-card compact">
                  <span className="card-kicker">Avancement</span>
                  <h3>
                    {overviewProgressCompleted} / {timeline.length} etapes
                  </h3>
                  <div className="progress-bar" aria-hidden="true">
                    <span style={{ width: `${overviewProgressPercent}%` }} />
                  </div>
                  <p className="workspace-card-description">{summary.currentStep}</p>
                  {overviewProgressNote ? (
                    <div className="workspace-card-meta-stack">
                      <span>{overviewProgressNote}</span>
                    </div>
                  ) : null}
                </article>
              </div>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Informations essentielles</h3>
                    <p className="meta">
                      Les informations utiles pour piloter cet appel d'offres sans detail technique.
                    </p>
                  </div>
                </div>
                <div className="section-body">
                  <div className="workspace-info-list">
                    <div className="workspace-info-row">
                      <span>Client</span>
                      <strong>{identity.clientLabel}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Pays</span>
                      <strong>{identity.countryLabel}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Responsable commercial</span>
                      <strong>{withDashFallback(identity.responsibleLabel)}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Date limite</span>
                      <strong>{formatDate(appel.dueDate)}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Priorite</span>
                      <strong>{identity.priorityLabel}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Reference</span>
                      <strong>{appel.reference || "—"}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>CDC source</span>
                      <strong>
                        {sourcePdfDocument?.fileName ??
                          (appel.artifacts.hasSourcePdf ? "Disponible" : "—")}
                      </strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Statut de la Fiche CDC</span>
                      <strong>{summary.ficheStatusLabel}</strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Derniere mise a jour</span>
                      <strong>{formatDateTime(appel.updatedAt)}</strong>
                    </div>
                  </div>
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

          {activeTab === "fiche" && !decisionCenterRole ? (
            <FicheEditor
              code={appel.code}
              appel={appel}
              onReviewStateChange={setReviewState}
            />
          ) : null}

          {activeTab === "fiche" && decisionCenterRole ? (
            <section className="section-card">
              <div className="section-header">
                <div>
                  <h3>Fiche CDC</h3>
                  <p className="meta">
                    La Fiche CDC reste un acces secondaire en lecture seule pour la Direction generale.
                  </p>
                </div>
              </div>
              <div className="section-body">
                <EmptyState
                  compact
                  title="Revue executive centralisee"
                  description="La decision finale se prepare depuis le centre de decision Go/No-Go. Les documents du dossier restent consultables sans exposer de controles de modification."
                />
                <div className="workspace-card-actions">
                  <button type="button" className="button button-secondary" onClick={() => updateView("documents")}>
                    Ouvrir les documents
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "fci" && !decisionCenterRole ? (
            <div className="stack">
              <section className="section-card">
                <div className="section-header">
                  <div>
                    <h3>Analyse du CDC</h3>
                    <p className="meta">
                      Suivez la generation de la Fiche CDC a partir du document transmis.
                    </p>
                  </div>
                </div>
                <div className="section-body stack">
                  <article className={`workspace-focus-card tone-${analysisGuidance.tone}`}>
                    <div className="workspace-focus-copy">
                      <span className="card-kicker">Prochaine etape</span>
                      <h3>{analysisGuidance.title}</h3>
                      <p>{analysisGuidance.description}</p>
                    </div>
                    {analysisGuidance.primaryAction ? (
                      <div className="workspace-focus-actions">
                        <button
                          type="button"
                          className={`button ${analysisGuidance.primaryAction.tone === "ai" ? "button-ai" : analysisGuidance.primaryAction.tone === "primary" ? "button-primary" : "button-secondary"}`}
                          onClick={() => handleAction(analysisGuidance.primaryAction)}
                        >
                          {analysisGuidance.primaryAction.label}
                        </button>
                      </div>
                    ) : null}
                  </article>

                  {failureSummary ? (
                    <div className="callout warning">
                      <strong>L'analyse n'a pas pu etre terminee.</strong>
                      <div>{failureSummary.message}</div>
                      <div>
                        Etape en echec : {failureSummary.stageLabel}
                        {failureSummary.failedAt ? ` - ${formatDateTime(failureSummary.failedAt)}` : ""}
                      </div>
                    </div>
                  ) : null}

                  <div className="processing-layout">
                    <ProcessingTimeline steps={timeline} />

                    <div className="processing-summary-grid">
                      <article className="summary-card processing-summary-card">
                        <span>Statut</span>
                        <strong>{summary.processingStateLabel}</strong>
                      </article>
                      <article className="summary-card processing-summary-card">
                        <span>Demarrage</span>
                        <strong>{formatDateTime(latestJob?.startedAt ?? null)}</strong>
                      </article>
                      <article className="summary-card processing-summary-card">
                        <span>Duree</span>
                        <strong>
                          {formatDurationOrElapsed(
                            latestJob?.startedAt ?? null,
                            latestJob?.finishedAt ?? null
                          )}
                        </strong>
                      </article>
                      <article className="summary-card processing-summary-card">
                        <span>Prochaine action</span>
                        <strong>{summary.nextAction}</strong>
                      </article>
                    </div>
                  </div>

                  {showAnalysisPanel ? (
                    <AppelOffresAnalysisPanel
                      code={appel.code}
                      hasSourcePdf={appel.artifacts.hasSourcePdf}
                      ficheStatus={appel.ficheStatus?.status ?? null}
                      hasFicheXml={appel.artifacts.hasFicheXml}
                      isRetryState={Boolean(
                        failureSummary?.retryAvailable || appel.ficheStatus?.status === "error"
                      )}
                    />
                  ) : null}

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
                        {latestJob?.contractVersion ? (
                          <span>Contract version : {latestJob.contractVersion}</span>
                        ) : null}
                        {latestJob?.callbackStatus ? (
                          <span>Callback : {latestJob.callbackStatus}</span>
                        ) : null}
                        {latestJob?.callbackIdempotencyKey ? (
                          <span>Callback key : {latestJob.callbackIdempotencyKey}</span>
                        ) : null}
                        {latestJob?.errorStage ? (
                          <span>Etape d'erreur : {latestJob.errorStage}</span>
                        ) : null}
                        {latestJob?.errorCode ? <span>Code erreur : {latestJob.errorCode}</span> : null}
                        {failureSummary?.technicalDetails ? (
                          <span>Detail brut : {failureSummary.technicalDetails}</span>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              </section>

              <FciWorkspace
                code={appel.code}
                onOpenFiche={() => updateView("fiche")}
              />
            </div>
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
