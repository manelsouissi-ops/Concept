"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FciClientError,
  getFciWorkspace,
  initializeFci,
  prepareFciGeneration,
  prepareFciRegeneration
} from "@/lib/appels-offres/fci/client.ts";
import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import type { FciAiSupportedModuleCode } from "@/lib/appels-offres/fci/ai-contracts.ts";
import { formatFciClientErrorMessage } from "@/lib/appels-offres/fci/ui.ts";
import { FciHeader } from "./fci-header.tsx";
import { FciOverview } from "./fci-overview.tsx";
import { FciEmptyState } from "./fci-empty-state.tsx";
import { FciErrorState } from "./fci-error-state.tsx";
import { FciModuleView } from "./fci-module-view.tsx";

const FCI_POLL_INTERVAL_MS = 4_000;
const FCI_MAX_POLL_ATTEMPTS = 30;

function isModuleCode(value: string | null): value is FciAiSupportedModuleCode {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

export function FciWorkspace({
  code,
  onOpenFiche
}: {
  code: string;
  onOpenFiche: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState<FciWorkspacePresentation | null>(null);
  const [error, setError] = useState<FciClientError | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<{
    moduleCode: FciAiSupportedModuleCode;
    kind: "generate" | "regenerate";
  } | null>(null);

  const selectedModule = useMemo(() => {
    const moduleParam = searchParams.get("fciModule");
    return isModuleCode(moduleParam) ? moduleParam : null;
  }, [searchParams]);

  async function loadWorkspace() {
    setError(null);
    try {
      const nextWorkspace = await getFciWorkspace(code);
      setWorkspace(nextWorkspace);
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
    void loadWorkspace();
  }, [code]);

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
        ?? "La génération FCI est toujours en cours. Actualisez le workspace pour vérifier l’avancement."
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

  function updateModuleParam(moduleCode: FciAiSupportedModuleCode | null) {
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
          setInfoMessage("Workspace FCI initialisé.");
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
    moduleCode: FciAiSupportedModuleCode,
    action: "generate" | "regenerate" | "validate"
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
          if (action === "generate") {
            await prepareFciGeneration(code, moduleCode);
            setInfoMessage("Génération lancée. Le module sera actualisé automatiquement.");
          } else {
            await prepareFciRegeneration(code, moduleCode);
            setInfoMessage("Régénération lancée. Le module sera actualisé automatiquement.");
          }
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

  if (selectedModule) {
    return (
      <FciModuleView
        code={code}
        moduleCode={selectedModule}
        onBack={() => updateModuleParam(null)}
        onWorkspaceRefresh={loadWorkspace}
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
      <FciErrorState message={formatFciClientErrorMessage(error)} onRetry={() => void loadWorkspace()} />
    );
  }

  return (
    <div className="workspace-stack">
      {pendingAction ? (
        <div className="callout info" aria-live="polite">
          {pendingAction.kind === "generate"
            ? `Lancement de la génération du module ${pendingAction.moduleCode}…`
            : `Lancement de la régénération du module ${pendingAction.moduleCode}…`}
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
          isBusy={pendingAction != null}
          busyMessage={
            pendingAction
              ? pendingAction.kind === "generate"
                ? `Génération du module ${pendingAction.moduleCode} en cours de lancement.`
                : `Régénération du module ${pendingAction.moduleCode} en cours de lancement.`
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
