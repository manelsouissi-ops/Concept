import { PageHeader } from "@/components/page-header.tsx";
import { PseudonymisationWorkspace } from "@/components/pseudonymisation-workspace.tsx";
import { requireAuthenticatedUserForPage } from "@/lib/auth/current-user.ts";

export default async function PseudonymisationPage() {
  await requireAuthenticatedUserForPage();

  return (
    <div className="page-stack">
      <PageHeader
        title="Pseudonymisation"
        description="Protégez les données sensibles avant de les partager avec un service d'IA externe."
      />
      <PseudonymisationWorkspace />
    </div>
  );
}
