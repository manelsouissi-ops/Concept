import { PageHeader } from "@/components/page-header.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { loadArchiveSummary, loadArchiveScanRuns, loadExtensionOptions } from "./actions.ts";
import ArchiveSummaryCards from "./archive-summary-cards.tsx";
import ArchiveInventoryTable from "./archive-inventory-table.tsx";

export default async function KnowledgeBasePage() {
  await requireAreaAccessForPage("archive");

  const [summary, scanRuns, extensionOptions] = await Promise.all([
    loadArchiveSummary(),
    loadArchiveScanRuns(),
    loadExtensionOptions()
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Archive Cartography"
        description="Inventaire structure des archives historiques de CONCEPT"
      />

      <div className="data-card">
        <div className="section-header">
          <h2 className="section-title">Phase 1 - Inventaire uniquement</h2>
        </div>

        <div className="section-body stack">
          <ArchiveSummaryCards summary={summary} scanRuns={scanRuns} />
          <ArchiveInventoryTable extensionOptions={extensionOptions} scanRuns={scanRuns} />
        </div>
      </div>
    </div>
  );
}
