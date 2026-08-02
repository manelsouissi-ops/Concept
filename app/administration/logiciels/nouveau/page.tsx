import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareForm } from "@/components/software-form.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

export default async function NewSoftwarePage() {
  await requireAreaAccessForPage("administration");
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
