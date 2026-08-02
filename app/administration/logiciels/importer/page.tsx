import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareImportWorkflow } from "@/components/software-import-workflow.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { shouldShowDevelopmentImportOptions } from "@/lib/administration/logiciels/import-presentation.ts";

export default async function SoftwareImportPage() {
  await requireAreaAccessForPage("administration");
  return (
    <div className="page-stack">
      <PageHeader
        title="Importer ou mettre a jour le catalogue"
        description="Chargez le catalogue Excel des logiciels de l'entreprise. La plateforme comparera le fichier avec les logiciels deja enregistres avant toute modification."
      />

      <SoftwareImportWorkflow
        showDevelopmentOptions={shouldShowDevelopmentImportOptions(process.env.NODE_ENV)}
      />
    </div>
  );
}
