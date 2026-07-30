import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareForm } from "@/components/software-form.tsx";
import { getSoftwareById } from "@/lib/administration/logiciels/repository.ts";

export default async function EditSoftwarePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const softwareId = Number(id);

  if (!Number.isInteger(softwareId) || softwareId <= 0) {
    notFound();
  }

  const software = await getSoftwareById(softwareId);
  if (!software) {
    notFound();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Modifier ${software.name}`}
        description="Ajustez le nom de reference, l'utilisation brute ou les alias sans ecraser silencieusement les variantes utiles."
      />

      <SoftwareForm mode="edit" software={software} />
    </div>
  );
}
