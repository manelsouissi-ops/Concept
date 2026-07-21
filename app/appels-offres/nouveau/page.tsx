import { AppelOffresForm } from "@/components/appel-offres-form.tsx";
import { PageHeader } from "@/components/page-header.tsx";

export default function NouvelAppelOffresPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Creation"
        title="Nouvel appel d'offres"
        description="Importez le CDC. La plateforme se charge d'extraire les informations et de preparer la Fiche CDC."
      />

      <AppelOffresForm mode="create" />
    </div>
  );
}
