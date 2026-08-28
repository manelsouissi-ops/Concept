import { StatCard } from "@/components/stat-card.tsx";
import { FileTextIcon, DatabaseIcon, ChartIcon, AlertIcon, ClockIcon } from "@/components/app-icons.tsx";
import { formatBytes, formatDate } from "@/lib/utils/format.ts";
import type { ArchiveSummary, ScanRun } from "./types.ts";

export default function ArchiveSummaryCards({
  summary,
  scanRuns
}: {
  summary: ArchiveSummary;
  scanRuns: ScanRun[];
}) {
  const { total_files, total_bytes, duplicate_files, failed_files, last_scan_date } = summary;
  const latestRun = scanRuns[0] ?? null;

  return (
    <section className="kpi-grid admin-kpi-grid">
      <StatCard
        icon={<FileTextIcon className="stat-icon" />}
        label="Fichiers"
        value={total_files.toLocaleString("fr-FR")}
        description="Total de fichiers catalogues"
      />
      <StatCard
        icon={<DatabaseIcon className="stat-icon" />}
        label="Stockage"
        value={formatBytes(total_bytes)}
        description="Taille totale cataloguee"
      />
      <StatCard
        icon={<ChartIcon className="stat-icon" />}
        label="Doublons"
        value={duplicate_files.toLocaleString("fr-FR")}
        description="Fichiers partageant un meme SHA256"
        tone={duplicate_files > 0 ? "warning" : "default"}
      />
      <StatCard
        icon={<AlertIcon className="stat-icon" />}
        label="Erreurs"
        value={failed_files.toLocaleString("fr-FR")}
        description="Fichiers en echec de decouverte"
        tone={failed_files > 0 ? "danger" : "default"}
      />
      <StatCard
        icon={<ClockIcon className="stat-icon" />}
        label="Dernier scan"
        value={last_scan_date ? formatDate(last_scan_date) : "Aucun"}
        description={latestRun ? `Statut : ${latestRun.status}` : "Aucun scan enregistre"}
      />
    </section>
  );
}
