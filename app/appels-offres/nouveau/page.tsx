import { AppelOffresCreateWizard } from "@/components/appel-offres-create-wizard.tsx";
import { requireTenderCreationAccessForPage } from "@/lib/auth/server.ts";

export default async function NouvelAppelOffresPage() {
  await requireTenderCreationAccessForPage();

  return (
    <div className="page-stack appel-offres-create-page">
      <section className="appel-offres-create-intro">
        <h1>Nouvel appel d'offres</h1>
        <p>Importez le CDC pour créer le dossier : CONCEPT détecte les informations principales.</p>
      </section>
      <AppelOffresCreateWizard />
    </div>
  );
}
