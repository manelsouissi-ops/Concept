import Link from "next/link";
import { AppelsOffresListView } from "@/components/appels-offres-list-view.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { buildAppelOffresSummary } from "@/lib/appels-offres/presentation.ts";
import {
  getAppelOffresDetailByCode,
  listAppelsOffres
} from "@/lib/appels-offres/repository.ts";

export default async function AppelsOffresPage() {
  try {
    const records = await listAppelsOffres({ archived: "all" });
    const details = (
      await Promise.all(
        records.map((record) => getAppelOffresDetailByCode(record.code, { includeArchived: true }))
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null);
    const summaries = details.map(buildAppelOffresSummary);

    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Opportunités"
          title="Appels d'offres"
          description="Centralisez, suivez et analysez les opportunités de l'entreprise."
          actions={
            <Link href="/appels-offres/nouveau" className="button button-primary">
              Nouvel appel d'offres
            </Link>
          }
        />

        <AppelsOffresListView items={summaries} />
      </div>
    );
  } catch (error) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Opportunités"
          title="Appels d'offres"
          description="Centralisez, suivez et analysez les opportunités de l'entreprise."
        />

        <section className="data-card">
          <div className="section-body">
            <EmptyState
              title="Chargement impossible"
              description={
                error instanceof Error
                  ? error.message
                  : "La liste des appels d'offres n'a pas pu être chargée."
              }
            />
          </div>
        </section>
      </div>
    );
  }
}
