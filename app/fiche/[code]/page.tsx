import { notFound } from "next/navigation";
import { FicheEditor } from "@/components/fiche-editor.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  getAppelOffresDetailByCode,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";

export default async function FichePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  await syncStoredDocumentsMetadata(code).catch(() => undefined);
  const appel = await getAppelOffresDetailByCode(code);

  if (!appel) {
    notFound();
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Relecture"
        title={`Fiche CDC ${code}`}
        description="Relisez, corrigez et validez la Fiche CDC dans le cadre du nouveau shell applicatif."
      />

      <FicheEditor code={code} appel={appel} />
    </div>
  );
}
