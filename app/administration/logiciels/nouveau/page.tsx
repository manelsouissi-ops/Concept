import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareForm } from "@/components/software-form.tsx";

export default async function NewSoftwarePage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Ajouter un logiciel"
        description="Ajoutez un logiciel de reference manuellement lorsque le catalogue n'est pas encore importe ou doit etre complete."
      />

      <SoftwareForm mode="create" />
    </div>
  );
}
