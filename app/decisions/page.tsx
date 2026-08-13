import { redirect } from "next/navigation";
import { DecisionWorkspace } from "@/components/decision-workspace.tsx";
import { getDecisionWorkspacePresentation } from "@/lib/appels-offres/decision-workspace.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

export default async function DecisionsPage() {
  const user = await requireAreaAccessForPage("appels_offres");
  if (user.role !== "DIRECTION_GENERALE") redirect("/forbidden");
  return <DecisionWorkspace workspace={await getDecisionWorkspacePresentation(user)} />;
}
