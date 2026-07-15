import { AppelOffresForm } from "@/components/appel-offres-form.tsx";
import { PageHeader } from "@/components/page-header.tsx";

export default function NouvelAppelOffresPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Création"
        title="Nouvel appel d'offres"
        description="Créez le dossier, importez le CDC et préparez le workspace de suivi."
      />

      <AppelOffresForm mode="create" />
    </div>
  );
}
