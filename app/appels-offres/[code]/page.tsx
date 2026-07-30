import { notFound } from "next/navigation";
import { AppelOffresWorkspace } from "@/components/appel-offres-workspace.tsx";
import { getFciSetByAppelOffresCode } from "@/lib/appels-offres/fci/repository.ts";
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
  | "documents"
  | "history";

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
      ? viewValue === "fiche-cdc" || viewValue === "information"
        ? "fiche"
        : viewValue === "processing"
          ? "fci"
          : ["overview", "fiche", "fci", "documents", "history"].includes(viewValue)
            ? (viewValue as WorkspaceView)
            : undefined
      : undefined;

  await syncStoredDocumentsMetadata(code).catch(() => undefined);
  const appel = await getAppelOffresDetailByCode(code);

  if (!appel) {
    notFound();
  }

  const fciSet = await getFciSetByAppelOffresCode(code).catch(() => null);
  const fciStatus = fciSet?.overallStatus ?? null;

  return (
    <div className="page-stack">
      <AppelOffresWorkspace
        appel={appel}
        flash={flash}
        initialTab={initialView}
        fciStatus={fciStatus}
      />
    </div>
  );
}
