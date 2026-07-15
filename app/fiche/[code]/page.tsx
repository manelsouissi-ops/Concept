import { FicheEditor } from "@/components/fiche-editor.tsx";
import { PageHeader } from "@/components/page-header.tsx";

export default async function FichePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Relecture"
        title={`Fiche CDC ${code}`}
        description="Relisez, corrigez et validez la Fiche CDC dans le cadre du nouveau shell applicatif."
      />

      <FicheEditor code={code} />
    </div>
  );
}
