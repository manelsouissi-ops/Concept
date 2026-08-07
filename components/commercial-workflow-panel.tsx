"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import type { GoNoGoView } from "@/lib/appels-offres/go-no-go/service.ts";
import { getGoNoGoView } from "@/lib/appels-offres/go-no-go/client.ts";
import {
  assignTenderModule,
  getAssignableUsers,
  getTenderAssignments,
  getTenderWorkflow,
  prepareTenderGoNoGo,
  reassignTenderModule,
  remindTenderAssignment,
  submitTenderToDg,
  WorkflowClientError
} from "@/lib/appels-offres/workflow/client.ts";
import type { FciModuleAssignmentDetail } from "@/lib/appels-offres/workflow/types.ts";
import type { TenderWorkflowEventRecord } from "@/lib/appels-offres/workflow/types.ts";
import type { TenderWorkflowStateView } from "@/lib/appels-offres/workflow/service.ts";
import type { UserRecord } from "@/lib/users/types.ts";

type AssignableModuleCode = "B" | "C";

type AssignmentState = {
  workflow: TenderWorkflowStateView | null;
  events: TenderWorkflowEventRecord[];
  assignments: FciModuleAssignmentDetail[];
  goNoGoView: GoNoGoView | null;
  assignableUsers: Record<AssignableModuleCode, UserRecord[]>;
  ownership: OwnershipPayload | null;
  eligibleOwners: UserRecord[];
};

type OwnershipPayload = {
  owner: {
    userId: number | null;
    displayName: string | null;
    email: string | null;
    jobTitle: string | null;
    status: string | null;
    assignedAt: string | null;
    assignedByName: string | null;
    reason: string | null;
    isRecoveryRequired: boolean;
    legacyResponsibleLabel: string | null;
  };
  history: Array<{
    id: number;
    previousOwnerName: string | null;
    newOwnerName: string | null;
    changedByName: string | null;
    reason: string | null;
    createdAt: string;
  }>;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error instanceof WorkflowClientError) {
    return error.message;
  }

  return "Le panneau de coordination n'a pas pu etre charge.";
}

async function readJsonOrThrow(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    ok?: boolean;
    ownership?: OwnershipPayload;
    users?: UserRecord[];
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Operation impossible.");
  }

  return payload;
}

async function fetchOwnership(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/owner`, {
    cache: "no-store"
  });
  const payload = await readJsonOrThrow(response);
  return payload.ownership ?? null;
}

async function fetchEligibleOwners() {
  const response = await fetch("/api/commercial/owners/eligible", {
    cache: "no-store"
  });
  const payload = await readJsonOrThrow(response);
  return payload.users ?? [];
}

async function assignOwner(code: string, newOwnerUserId: number, reason: string | null) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/owner/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_owner_user_id: newOwnerUserId, reason })
  });
  await readJsonOrThrow(response);
}

async function transferOwner(code: string, newOwnerUserId: number, reason: string | null) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/owner/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_owner_user_id: newOwnerUserId, reason })
  });
  await readJsonOrThrow(response);
}

function getWorkflowBadge(workflow: TenderWorkflowStateView | null) {
  if (!workflow) {
    return { label: "Indisponible", tone: "neutral" as const };
  }

  if (workflow.explicit_state === "SUBMITTED_TO_DG" || workflow.explicit_state === "UNDER_DG_REVIEW") {
    return { label: "En attente DG", tone: "info" as const };
  }

  if (workflow.ready_for_gonogo) {
    return { label: "Pret pour Go/No-Go", tone: "success" as const };
  }

  if (!workflow.assignments_complete) {
    return { label: "A affecter", tone: "warning" as const };
  }

  return { label: "FCI en cours", tone: "warning" as const };
}

function getNextAction(workflow: TenderWorkflowStateView | null) {
  if (!workflow) {
    return "Verifier le chargement du workflow.";
  }

  if (!workflow.assignments_complete) {
    return "Affecter Finance et Operations.";
  }

  if (!workflow.ready_for_gonogo) {
    return "Finaliser les validations A, B et C.";
  }

  if (workflow.explicit_state === "GONOGO_PREPARED") {
    return "Soumettre le dossier a la Direction generale.";
  }

  if (workflow.explicit_state === "SUBMITTED_TO_DG" || workflow.explicit_state === "UNDER_DG_REVIEW") {
    return "Attendre la decision de la Direction generale.";
  }

  return "Preparer le package Go/No-Go.";
}

function formatEventLabel(event: TenderWorkflowEventRecord) {
  switch (event.eventType) {
    case "gonogo_prepared":
      return "Package Go/No-Go prepare";
    case "submitted_to_dg":
      return "Soumis a la Direction generale";
    case "under_dg_review":
      return "Relecture DG en cours";
    case "state_changed":
      return "Etat de workflow mis a jour";
    default:
      return event.eventType;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getContributingModuleSummary(view: GoNoGoView | null, moduleCode: "A" | "B" | "C") {
  return view?.fci.modules.find((module) => module.module_code === moduleCode) ?? null;
}

function getAssignment(assignments: FciModuleAssignmentDetail[], moduleCode: AssignableModuleCode) {
  return assignments.find((assignment) => assignment.moduleCode === moduleCode) ?? null;
}

export function CommercialWorkflowPanel({
  code,
  onOpenFci,
  onOpenFciModule,
  onOpenGoNoGo
}: {
  code: string;
  onOpenFci: () => void;
  onOpenFciModule: (moduleCode: "A" | "B" | "C") => void;
  onOpenGoNoGo: () => void;
}) {
  const [state, setState] = useState<AssignmentState>({
    workflow: null,
    events: [],
    assignments: [],
    goNoGoView: null,
    assignableUsers: { B: [], C: [] },
    ownership: null,
    eligibleOwners: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOwnershipHistory, setShowOwnershipHistory] = useState(false);
  const [selectedAssigneeByModule, setSelectedAssigneeByModule] = useState<Record<AssignableModuleCode, string>>({
    B: "",
    C: ""
  });
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState("");

  async function loadPanel() {
    setIsLoading(true);
    try {
      const [workflowData, assignments, goNoGoView, financeUsers, operationsUsers, ownership, eligibleOwners] = await Promise.all([
        getTenderWorkflow(code),
        getTenderAssignments(code),
        getGoNoGoView(code),
        getAssignableUsers(code, "B"),
        getAssignableUsers(code, "C"),
        fetchOwnership(code),
        fetchEligibleOwners()
      ]);

      setState({
        workflow: workflowData.workflow,
        events: workflowData.events,
        assignments,
        goNoGoView,
        assignableUsers: {
          B: financeUsers,
          C: operationsUsers
        },
        ownership,
        eligibleOwners
      });
      setSelectedAssigneeByModule({
        B: String(getAssignment(assignments, "B")?.assignedUserId ?? ""),
        C: String(getAssignment(assignments, "C")?.assignedUserId ?? "")
      });
      setSelectedOwnerUserId(String(ownership?.owner.userId ?? eligibleOwners[0]?.id ?? ""));
      setError(null);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPanel();
  }, [code]);

  async function handleAssign(moduleCode: AssignableModuleCode) {
    const selectedValue = Number(selectedAssigneeByModule[moduleCode]);
    if (!Number.isInteger(selectedValue) || selectedValue < 1) {
      setActionError("Selectionnez un utilisateur actif avant de confirmer l'affectation.");
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setMessage(null);
    try {
      const existing = getAssignment(state.assignments, moduleCode);
      if (existing) {
        await reassignTenderModule(code, moduleCode, selectedValue);
        setMessage(`La contribution ${moduleCode} a ete reaffectee.`);
      } else {
        await assignTenderModule(code, moduleCode, selectedValue);
        setMessage(`La contribution ${moduleCode} a ete affectee.`);
      }
      await loadPanel();
    } catch (nextError) {
      setActionError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReminder(moduleCode: AssignableModuleCode) {
    const confirmed = window.confirm(
      `Envoyer un rappel pour la contribution ${moduleCode} ?`
    );
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setMessage(null);
    try {
      await remindTenderAssignment(code, moduleCode);
      setMessage(`Un rappel a ete envoye pour la contribution ${moduleCode}.`);
      await loadPanel();
    } catch (nextError) {
      setActionError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePrepare() {
    setIsSubmitting(true);
    setActionError(null);
    setMessage(null);
    try {
      await prepareTenderGoNoGo(code);
      setMessage("Le package Go/No-Go a ete prepare.");
      await loadPanel();
    } catch (nextError) {
      setActionError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setActionError(null);
    setMessage(null);
    try {
      await submitTenderToDg(code);
      setMessage("Le dossier a ete soumis a la Direction generale.");
      await loadPanel();
    } catch (nextError) {
      setActionError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOwnerAction() {
    const nextOwnerUserId = Number(selectedOwnerUserId);
    if (!Number.isInteger(nextOwnerUserId) || nextOwnerUserId < 1) {
      setActionError("Selectionnez un responsable commercial actif.");
      return;
    }

    const hasOwner = state.ownership?.owner.userId != null;
    const confirmed = window.confirm(
      hasOwner
        ? "Confirmer le transfert de responsabilite commerciale pour ce dossier ?"
        : "Attribuer ce dossier a ce responsable commercial ?"
    );
    if (!confirmed) {
      return;
    }

    const reason = window.prompt(
      hasOwner ? "Motif du transfert (optionnel)" : "Motif de l'attribution (optionnel)",
      ""
    );

    setIsSubmitting(true);
    setActionError(null);
    setMessage(null);
    try {
      if (hasOwner) {
        await transferOwner(code, nextOwnerUserId, reason);
        setMessage("La responsabilite commerciale du dossier a ete transferee.");
      } else {
        await assignOwner(code, nextOwnerUserId, reason);
        setMessage("Le dossier a ete attribue a un responsable commercial.");
      }
      await loadPanel();
    } catch (nextError) {
      setActionError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !state.workflow) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement de la coordination Commerciale...</p>
        </div>
      </section>
    );
  }

  if (error && !state.workflow) {
    return (
      <section className="section-card">
        <div className="section-body">
          <div className="callout warning">{error}</div>
        </div>
      </section>
    );
  }

  const workflowBadge = getWorkflowBadge(state.workflow);
  const moduleA = getContributingModuleSummary(state.goNoGoView, "A");
  const moduleB = getContributingModuleSummary(state.goNoGoView, "B");
  const moduleC = getContributingModuleSummary(state.goNoGoView, "C");
  const assignmentB = getAssignment(state.assignments, "B");
  const assignmentC = getAssignment(state.assignments, "C");
  const canPrepare = state.workflow?.ready_for_gonogo
    && state.workflow.explicit_state !== "GONOGO_PREPARED"
    && state.workflow.explicit_state !== "SUBMITTED_TO_DG"
    && state.workflow.explicit_state !== "UNDER_DG_REVIEW";
  const canSubmit = state.workflow?.explicit_state === "GONOGO_PREPARED";
  const isSubmitted = state.workflow?.explicit_state === "SUBMITTED_TO_DG"
    || state.workflow?.explicit_state === "UNDER_DG_REVIEW";
  const currentUserId = Number(state.goNoGoView?.current_user.id ?? 0);
  const commercialOwner = state.ownership?.owner ?? null;
  const isCommercialOwner =
    Number.isInteger(currentUserId)
    && currentUserId > 0
    && commercialOwner?.userId != null
    && commercialOwner.userId === currentUserId;
  const canManageOwnership = !commercialOwner?.userId || isCommercialOwner;
  const coordinationLocked = !isCommercialOwner;

  return (
    <div className="stack">
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Responsable commercial</h3>
            <p className="meta">Un seul responsable canonique coordonne ce dossier.</p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="workspace-info-list">
            <div className="workspace-info-row">
              <span>Responsable</span>
              <strong>{commercialOwner?.displayName ?? "A attribuer"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Fonction</span>
              <strong>{commercialOwner?.jobTitle ?? "Non renseignee"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Attribue le</span>
              <strong>{formatDateTime(commercialOwner?.assignedAt)}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Attribue par</span>
              <strong>{commercialOwner?.assignedByName ?? "Non renseigne"}</strong>
            </div>
          </div>
          {!isCommercialOwner && commercialOwner?.displayName ? (
            <div className="callout info">
              Ce dossier est coordonne par {commercialOwner.displayName}.
            </div>
          ) : null}
          {canManageOwnership ? (
            <div className="workspace-card compact">
              <span className="card-kicker">
                {commercialOwner?.userId ? "Transferer le dossier" : "Attribuer un responsable"}
              </span>
              <div className="stack">
                <select
                  className="input"
                  value={selectedOwnerUserId}
                  onChange={(event) => setSelectedOwnerUserId(event.target.value)}
                >
                  <option value="">Selectionner un Commercial</option>
                  {state.eligibleOwners.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
                <div className="workspace-card-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void handleOwnerAction()}
                    disabled={isSubmitting}
                  >
                    {commercialOwner?.userId ? "Transferer le dossier" : "Attribuer un responsable"}
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setShowOwnershipHistory((current) => !current)}
                  >
                    {showOwnershipHistory ? "Masquer l'historique" : "Consulter l'historique"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {showOwnershipHistory && state.ownership?.history.length ? (
            <div className="department-history-list">
              {state.ownership.history.slice(0, 6).map((event) => (
                <article key={event.id} className="department-history-item">
                  <div className="department-history-copy">
                    <strong>{event.newOwnerName ?? "Responsable attribue"}</strong>
                    <span>
                      {event.previousOwnerName
                        ? `Depuis ${event.previousOwnerName}`
                        : "Attribution initiale"}
                    </span>
                    <small>{event.reason ?? "Sans motif explicite"}</small>
                  </div>
                  <span className="department-history-date">{formatDateTime(event.createdAt)}</span>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Etat du workflow</h3>
            <p className="meta">Vue d'ensemble de l'orchestration FCI et Go/No-Go.</p>
          </div>
          <StatusBadge label={workflowBadge.label} tone={workflowBadge.tone} />
        </div>
        <div className="section-body">
          <div className="workspace-info-list">
            <div className="workspace-info-row">
              <span>Etat explicite</span>
              <strong>{state.workflow?.explicit_state ?? "Non initialise"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Etat derive</span>
              <strong>{state.workflow?.derived_state ?? "Aucun"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Readiness A/B/C</span>
              <strong>{state.workflow?.ready_for_gonogo ? "Pret pour Go/No-Go" : "En attente"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Prochaine action</span>
              <strong>{getNextAction(state.workflow)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Affectation des contributions</h3>
            <p className="meta">Seuls les utilisateurs actifs et du bon service sont proposables.</p>
          </div>
        </div>
        <div className="section-body stack">
          {(["B", "C"] as AssignableModuleCode[]).map((moduleCode) => {
            const assignment = moduleCode === "B" ? assignmentB : assignmentC;
            const candidates = state.assignableUsers[moduleCode];
            return (
              <article key={moduleCode} className="workspace-focus-card tone-default">
                <div className="workspace-focus-copy">
                  <span className="card-kicker">Contribution {moduleCode}</span>
                  <h3>{moduleCode === "B" ? "Finance" : "Operations"}</h3>
                  <p>
                    {assignment
                      ? `Affectee a ${assignment.assignedUserName} le ${formatDateTime(assignment.assignedAt)}.`
                      : "Cette contribution n'est pas encore affectee."}
                  </p>
                </div>
                <div className="stack" style={{ minWidth: 280 }}>
                  <select
                    className="input"
                    value={selectedAssigneeByModule[moduleCode]}
                    onChange={(event) =>
                      setSelectedAssigneeByModule((current) => ({
                        ...current,
                        [moduleCode]: event.target.value
                      }))
                    }
                  >
                    <option value="">Selectionner un utilisateur</option>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleAssign(moduleCode)}
                      disabled={isSubmitting || coordinationLocked}
                    >
                      {assignment ? "Reaffecter" : "Affecter"}
                    </button>
                    {assignment ? (
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => void handleReminder(moduleCode)}
                        disabled={isSubmitting || coordinationLocked}
                      >
                        Relancer
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Suivi A / B / C</h3>
            <p className="meta">Lecture des statuts departementaux avant preparation du dossier.</p>
          </div>
        </div>
        <div className="section-body">
          <div className="workspace-info-list">
            <div className="workspace-info-row">
              <span>Commercial A</span>
              <strong>
                {moduleA?.status ?? "En attente"}
                <button type="button" className="button button-ghost button-small" onClick={() => onOpenFciModule("A")}>
                  Ouvrir
                </button>
              </strong>
            </div>
            <div className="workspace-info-row">
              <span>Finance B</span>
              <strong>
                {assignmentB ? `${assignmentB.assignedUserName} · ${moduleB?.status ?? "En attente"}` : "A affecter"}
                <button type="button" className="button button-ghost button-small" onClick={() => onOpenFciModule("B")}>
                  Ouvrir
                </button>
              </strong>
            </div>
            <div className="workspace-info-row">
              <span>Operations C</span>
              <strong>
                {assignmentC ? `${assignmentC.assignedUserName} · ${moduleC?.status ?? "En attente"}` : "A affecter"}
                <button type="button" className="button button-ghost button-small" onClick={() => onOpenFciModule("C")}>
                  Ouvrir
                </button>
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Activite recente</h3>
            <p className="meta">Affectations, transitions workflow et suivi recent du dossier.</p>
          </div>
        </div>
        <div className="section-body">
          {state.events.length > 0 ? (
            <div className="department-history-list">
              {state.events.slice(0, 8).map((event) => (
                <article key={event.id} className="department-history-item">
                  <div className="department-history-copy">
                    <strong>{formatEventLabel(event)}</strong>
                    <span>{event.actorName ?? "Systeme"}</span>
                  </div>
                  <span className="department-history-date">{formatDateTime(event.createdAt)}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucune activite recente"
              description="Les prochains mouvements de workflow apparaitront ici."
            />
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Preparation Go/No-Go</h3>
            <p className="meta">Le rapport consolide se prepare dans l'onglet Go/No-Go avant soumission a la DG.</p>
          </div>
        </div>
        <div className="section-body stack">
          {message ? <div className="callout info">{message}</div> : null}
          {actionError ? <div className="callout warning">{actionError}</div> : null}
          <div className="workspace-card-actions">
            <button type="button" className="button button-secondary" onClick={onOpenFci}>
              Ouvrir les FCI
            </button>
            <button type="button" className="button button-secondary" onClick={onOpenGoNoGo}>
              Ouvrir le rapport
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handlePrepare()}
              disabled={!canPrepare || isSubmitting || coordinationLocked}
            >
              Preparer le Go/No-Go
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || isSubmitting || coordinationLocked}
            >
              Soumettre a la DG
            </button>
          </div>
          {coordinationLocked ? (
            <div className="callout info">
              Seul le responsable commercial courant peut affecter, relancer, preparer et soumettre ce dossier.
            </div>
          ) : null}
          {isSubmitted ? (
            <div className="callout info">
              En attente de decision DG. La soumission est deja enregistree pour ce dossier.
            </div>
          ) : null}
          <div className="workspace-card compact">
            <span className="card-kicker">Rapport consolidé</span>
            <p>
              Generez, complétez et exportez le rapport officiel depuis l&apos;onglet Go/No-Go.
              La préparation et la soumission restent bloquées tant que le rapport n&apos;est pas complet et à jour.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
