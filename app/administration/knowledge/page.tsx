import { PageHeader } from "@/components/page-header.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { loadArchiveSummary, loadArchiveScanRuns, loadExtensionOptions } from "./actions.ts";
import ArchiveSummaryCards from "./archive-summary-cards.tsx";
import ArchiveInventoryTable from "./archive-inventory-table.tsx";
import { loadCdcReviewSummary, loadCdcImportBatches } from "./cdc-review-actions.ts";
import CdcReviewSummaryCards from "./cdc-review-summary.tsx";
import CdcCandidatesTable from "./cdc-candidates-table.tsx";
import CdcImportBatches from "./cdc-import-batches.tsx";
import KnowledgeViewTabs from "./knowledge-view-tabs.tsx";
import { resolveKnowledgeView } from "./knowledge-view.ts";

export default async function KnowledgeBasePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAreaAccessForPage("archive");

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawView = resolvedSearchParams?.view;
  const view = resolveKnowledgeView(Array.isArray(rawView) ? rawView[0] : rawView);

  return (
    <div className="page-stack">
      <PageHeader
        title="Base de connaissances CDC & Archives"
        description="Suivi des CDC validés, de l’extraction locale de leurs 21 critères et de la cartographie des archives historiques."
        metadata={<span className="page-eyebrow">LECTURE SEULE</span>}
      />

      <div className="tabs-card data-card">
        <KnowledgeViewTabs active={view} />

        <div className="tabs-panel">
          {view === "cdc" ? <CdcView /> : <ArchivesView />}
        </div>
      </div>
    </div>
  );
}

async function CdcView() {
  const [cdcSummary, cdcImportBatches] = await Promise.all([
    loadCdcReviewSummary(),
    loadCdcImportBatches()
  ]);

  return (
    <div className="stack">
      <div className="section-header">
        <h2 className="section-title">Validation humaine CDC</h2>
        <p>
          Revue humaine des candidats CDC (cahiers des charges) - lecture seule. Inspection initiale,
          validation humaine et extraction des 21 critères sont trois étapes distinctes : cette section
          couvre uniquement la validation humaine déjà effectuée et son résultat.
        </p>
      </div>

      <CdcReviewSummaryCards summary={cdcSummary} />

      <div className="section-header">
        <h3 className="section-title">Lot de revue humaine</h3>
      </div>
      <CdcImportBatches batches={cdcImportBatches} />

      {cdcSummary.unresolved > 0 ? (
        <div className="callout warning">
          {cdcSummary.unresolved} candidat{cdcSummary.unresolved > 1 ? "s" : ""} à revoir - décision
          incertaine lors de la revue humaine. Non rejeté{cdcSummary.unresolved > 1 ? "s" : ""}, non
          approuvé{cdcSummary.unresolved > 1 ? "s" : ""}. Aucune extraction des 21 critères n&apos;est
          planifiée pour ce{cdcSummary.unresolved > 1 ? "s" : ""} candidat{cdcSummary.unresolved > 1 ? "s" : ""}
          tant qu&apos;une décision n&apos;a pas été prise.
        </div>
      ) : null}

      <div className="section-header">
        <h3 className="section-title">Candidats CDC</h3>
      </div>
      <CdcCandidatesTable />
    </div>
  );
}

async function ArchivesView() {
  const [summary, scanRuns, extensionOptions] = await Promise.all([
    loadArchiveSummary(),
    loadArchiveScanRuns(),
    loadExtensionOptions()
  ]);

  return (
    <div className="stack">
      <div className="section-header">
        <h2 className="section-title">Phase 1 - Inventaire uniquement</h2>
        <p>Classification automatique</p>
      </div>

      <ArchiveSummaryCards summary={summary} scanRuns={scanRuns} />
      <ArchiveInventoryTable extensionOptions={extensionOptions} scanRuns={scanRuns} />
    </div>
  );
}
