import { notFound } from "next/navigation";
import { AppelOffresWorkspace } from "@/components/appel-offres-workspace.tsx";
import { resolveAppelOffresWorkspaceView } from "@/lib/appels-offres/dossier-experience.ts";
import { getFciDetailByAppelOffresCode } from "@/lib/appels-offres/fci/repository.ts";
import { deriveTenderWorkflowState } from "@/lib/appels-offres/workflow/service.ts";
import { getLatestGoNoGoDecisionByAppelOffresId } from "@/lib/appels-offres/go-no-go/repository.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import {
  getAppelOffresDetailByCode,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";

type WorkspaceFlash = "created-processing" | "launch-failed" | "analysis-started";
type WorkspaceView =
  | "overview"
  | "processing"
  | "fiche"
  | "fci"
  | "go-no-go"
  | "documents"
  | "history";

export default async function AppelOffresDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireAreaAccessForPage("appels_offres");
  const { code } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const flashValue = resolvedSearchParams?.flash;
  const viewValue = resolvedSearchParams?.view;
  const flash =
    typeof flashValue === "string" &&
    ["created-processing", "launch-failed", "analysis-started"].includes(flashValue)
      ? (flashValue as WorkspaceFlash)
      : undefined;
  const requestedView =
    typeof viewValue === "string"
      ? viewValue === "fiche-cdc" || viewValue === "information"
        ? "fiche"
        : viewValue === "processing"
          ? "overview"
          : ["overview", "fiche", "fci", "go-no-go", "documents", "history"].includes(viewValue)
            ? (viewValue as WorkspaceView)
            : undefined
      : undefined;
  const initialView = resolveAppelOffresWorkspaceView({
    requestedView,
    role: currentUser.role
  });

  await syncStoredDocumentsMetadata(code).catch(() => undefined);
  const appel = await getAppelOffresDetailByCode(code);

  if (!appel) {
    notFound();
  }

  const [fciDetail, workflow, decision] = await Promise.all([
    getFciDetailByAppelOffresCode(code).catch(() => null),
    deriveTenderWorkflowState(code).catch(() => null),
    getLatestGoNoGoDecisionByAppelOffresId(appel.id).catch(() => null)
  ]);
  const fciStatus = fciDetail?.set.overallStatus ?? null;

  return (
    <div className="page-stack">
      <AppelOffresWorkspace
        appel={appel}
        flash={flash}
        initialTab={initialView}
        fciStatus={fciStatus}
        fciDetail={fciDetail}
        workflow={workflow}
        decision={decision}
        currentUserRole={currentUser.role}
      />
    </div>
  );
}
