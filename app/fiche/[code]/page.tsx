import { FicheEditor } from "@/components/fiche-editor";

export default async function FichePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">Relecture</span>
        <h1>Fiche Projet {code}</h1>
        <p>
          Les champs de l&apos;extraction restent modifiables tant que la fiche
          n&apos;est pas validée. Les badges de source restent visibles pour
          soutenir la revue humaine.
        </p>
      </section>

      <FicheEditor code={code} />
    </main>
  );
}
