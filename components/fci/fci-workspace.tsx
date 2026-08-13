"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FciClientError,
  getFciWorkspace,
  initializeFci,
  prepareFciRegeneration
} from "@/lib/appels-offres/fci/client.ts";
import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import type { FciHumanVisibleModuleCode } from "@/lib/appels-offres/fci/types.ts";
import { formatFciClientErrorMessage } from "@/lib/appels-offres/fci/ui.ts";
import { getFciModuleForRole } from "@/lib/auth/rbac.ts";
import type { UserRole } from "@/lib/auth/rbac.ts";
import { getTenderAssignments } from "@/lib/appels-offres/workflow/client.ts";
import type { FciModuleAssignmentDetail } from "@/lib/appels-offres/workflow/types.ts";
import { FciHeader } from "./fci-header.tsx";
import { FciOverview } from "./fci-overview.tsx";
import { FciBlockedState } from "./fci-blocked-state.tsx";
import { FciEmptyState } from "./fci-empty-state.tsx";
import { FciErrorState } from "./fci-error-state.tsx";
import { FciModuleView } from "./fci-module-view.tsx";
import { FciModuleReadOnlyView } from "./fci-module-readonly-view.tsx";

const FCI_POLL_INTERVAL_MS = 4_000;
const FCI_MAX_POLL_ATTEMPTS = 30;

function isHumanVisibleModuleCode(value: string | null): value is FciHumanVisibleModuleCode {
  return value === "A" || value === "B" || value === "C";
}

export function FciWorkspace({
  code,
  ficheValidated,
  currentUserRole,
  onOpenFiche
}: {
  code: string;
  ficheValidated: boolean;
  currentUserRole?: UserRole;
  onOpenFiche: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState<FciWorkspacePresentation | null>(null);
  const [assignments, setAssignments] = useState<FciModuleAssignmentDetail[]>([]);
  const [error, setError] = useState<FciClientError | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<{
    moduleCode: FciHumanVisibleModuleCode;
    kind: "regenerate";
  } | null>(null);

  const selectedModule = useMemo(() => {
    const moduleParam = searchParams.get("fciModule");
    return isHumanVisibleModuleCode(moduleParam) ? moduleParam : null;
  }, [searchParams]);

  async function loadWorkspace() {
    setError(null);
    try {
      const nextWorkspace = await getFciWorkspace(code);
      setWorkspace(nextWorkspace);
      // Best-effort: assignee names are a display nicety for the tracking
      // rows, not required for the workspace itself to render correctly.
      getTenderAssignments(code).then(setAssignments).catch(() => setAssignments([]));
    } catch (nextError) {
      if (nextError instanceof FciClientError) {
        setError(nextError);
        return;
      }

      setError(
        new FciClientError(500, {
          code: "FCI_UI_LOAD_ERROR",
          message: "Impossible de charger le workspace FCI.",
          details: {}
        })
      );
    }
  }

  useEffect(() => {
    if (!ficheValidated) {
      return;
    }
    void loadWorkspace();
  }, [code, ficheValidated]);

  const isPollingGeneration = useMemo(
    () => workspace?.module_summaries.some((summary) => summary.status === "generating") ?? false,
    [workspace]
  );

  useEffect(() => {
    if (!isPollingGeneration) {
      setPollAttempts(0);
      return;
    }

    if (pollAttempts >= FCI_MAX_POLL_ATTEMPTS) {
      setInfoMessage((current) =>
        current
        ?? "La generation FCI est toujours en cours. Actualisez le workspace pour verifier l'avancement."
      );
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadWorkspace().finally(() => {
        setPollAttempts((current) => current + 1);
      });
    }, FCI_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [code, isPollingGeneration, pollAttempts]);

  function updateModuleParam(moduleCode: FciHumanVisibleModuleCode | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (moduleCode) {
      params.set("fciModule", moduleCode);
    } else {
      params.delete("fciModule");
    }
    params.set("view", "fci");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleInitialize() {
    startTransition(() => {
      void (async () => {
        try {
          const nextWorkspace = await initializeFci(code);
          setWorkspace(nextWorkspace);
          setError(null);
          setInfoMessage("Workspace FCI initialise.");
        } catch (nextError) {
          setError(
            nextError instanceof FciClientError
              ? nextError
              : new FciClientError(500, {
                  code: "FCI_INITIALIZE_ERROR",
                  message: "Impossible d'initialiser la FCI.",
                  details: {}
                })
          );
        }
      })();
    });
  }

  function handlePrepareAction(
    moduleCode: FciHumanVisibleModuleCode,
    action: "regenerate" | "validate"
  ) {
    if (action === "validate") {
      updateModuleParam(moduleCode);
      return;
    }

    startTransition(() => {
      void (async () => {
        setActionErrorMessage(null);
        setPendingAction({ moduleCode, kind: action });
        try {
          await prepareFciRegeneration(code, moduleCode);
          setInfoMessage("Regeneration lancee. Le module sera actualise automatiquement.");
          setPollAttempts(0);
          await loadWorkspace();
        } catch (nextError) {
          const nextClientError =
            nextError instanceof FciClientError
              ? nextError
              : new FciClientError(500, {
                  code: "FCI_ACTION_ERROR",
                  message: "Action FCI impossible.",
                  details: {}
                });
          setActionErrorMessage(formatFciClientErrorMessage(nextClientError));
        } finally {
          setPendingAction(null);
        }
      })();
    });
  }

  if (!ficheValidated) {
    return <FciBlockedState onOpenFiche={onOpenFiche} />;
  }

  if (selectedModule) {
    const isOwnModule = currentUserRole != null && getFciModuleForRole(currentUserRole) === selectedModule;

    return isOwnModule ? (
      <FciModuleView
        code={code}
        moduleCode={selectedModule}
        onBack={() => updateModuleParam(null)}
        onWorkspaceRefresh={loadWorkspace}
      />
    ) : (
      <FciModuleReadOnlyView
        code={code}
        moduleCode={selectedModule}
        onBack={() => updateModuleParam(null)}
      />
    );
  }

  if (error?.code === "FCI_NOT_INITIALIZED") {
    return (
      <div className="workspace-stack">
        <FciHeader
          workspace={workspace}
          onRefresh={() => void loadWorkspace()}
          onInitialize={handleInitialize}
          onOpenFiche={onOpenFiche}
        />
        <FciEmptyState onInitialize={handleInitialize} />
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <FciErrorState
        message={formatFciClientErrorMessage(error)}
        onRetry={() => void loadWorkspace()}
      />
    );
  }

  return (
    <div className="workspace-stack">
      {pendingAction ? (
        <div className="callout info" aria-live="polite">
          {`Lancement de la regeneration du module ${pendingAction.moduleCode}...`}
        </div>
      ) : null}
      {actionErrorMessage ? (
        <div className="callout warning" role="alert">
          {actionErrorMessage}
        </div>
      ) : null}
      {infoMessage ? <div className="callout info" aria-live="polite">{infoMessage}</div> : null}
      <FciHeader
        workspace={workspace}
        onRefresh={() => void loadWorkspace()}
        onInitialize={handleInitialize}
        onOpenFiche={onOpenFiche}
      />
      {isPending && !workspace ? (
        <section className="section-card">
          <div className="section-body">
            <p className="meta">Chargement du workspace FCI...</p>
          </div>
        </section>
      ) : null}
      {workspace ? (
        <FciOverview
          workspace={workspace}
          assignments={assignments}
          isBusy={pendingAction != null}
          busyMessage={
            pendingAction
              ? `Regeneration du module ${pendingAction.moduleCode} en cours de lancement.`
              : undefined
          }
          onOpenModule={(moduleCode) => updateModuleParam(moduleCode)}
          onPrepareAction={handlePrepareAction}
          onOpenHistory={(moduleCode) => updateModuleParam(moduleCode)}
        />
      ) : null}
    </div>
  );
}
