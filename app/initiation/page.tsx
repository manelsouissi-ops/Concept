import { InitiationForm } from "@/components/initiation-form";
import { PageHeader } from "@/components/page-header.tsx";

export default function InitiationPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Compatibilité"
        title="Initiation CDC"
        description="Ancien point d'entrée conservé pour compatibilité, sans en faire le parcours principal."
      />

      <section className="data-card">
        <div className="section-body">
          <InitiationForm />
        </div>
      </section>
    </div>
  );
}
