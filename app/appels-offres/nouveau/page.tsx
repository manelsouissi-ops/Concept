import { AppelOffresForm } from "@/components/appel-offres-form.tsx";

export default function NouvelAppelOffresPage() {
  return (
    <div className="page-stack appel-offres-create-page">
      <section className="appel-offres-create-intro">
        <h1>Nouvel appel d'offres</h1>
        <p>Importez votre CDC PDF pour creer le dossier.</p>
      </section>
      <AppelOffresForm mode="create" />
    </div>
  );
}
