import { InitiationForm } from "@/components/initiation-form";

export default function InitiationPage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">Initiation CDC</span>
        <h1>Déposer un CDC et générer sa fiche projet.</h1>
        <p>
          Cette première version enregistre le PDF d&apos;origine, stocke la fiche
          XML sur disque et laisse la validation humaine visible et éditable.
        </p>
      </section>

      <section className="panel">
        <div className="panel-inner">
          <InitiationForm />
        </div>
      </section>
    </main>
  );
}
