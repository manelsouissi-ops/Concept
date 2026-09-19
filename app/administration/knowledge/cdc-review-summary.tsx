import { StatCard } from "@/components/stat-card.tsx";
import { ChartIcon, FileTextIcon, DatabaseIcon, AlertIcon, ClockIcon } from "@/components/app-icons.tsx";
import type { CdcReviewSummary } from "@/lib/archive-cartography/cdc-review.ts";

export default function CdcReviewSummaryCards({ summary }: { summary: CdcReviewSummary }) {
  const { total, validated, rejected, unresolved, recentUsable, olderUsable, linkedToCompletedBatch } = summary;

  return (
    <section className="kpi-grid admin-kpi-grid">
      <StatCard
        icon={<FileTextIcon className="stat-icon" />}
        label="Candidats revus"
        value={total.toLocaleString("fr-FR")}
        description="Total de candidats CDC passes en revue humaine"
      />
      <StatCard
        icon={<DatabaseIcon className="stat-icon" />}
        label="CDC utilisables"
        value={validated.toLocaleString("fr-FR")}
        description="Valides par la revue humaine (Youssef)"
        tone="success"
      />
      <StatCard
        icon={<AlertIcon className="stat-icon" />}
        label="Candidats rejetes"
        value={rejected.toLocaleString("fr-FR")}
        description="Ecartes par la revue humaine"
        tone={rejected > 0 ? "danger" : "default"}
      />
      <StatCard
        icon={<ClockIcon className="stat-icon" />}
        label="A revoir"
        value={unresolved.toLocaleString("fr-FR")}
        description="Decision incertaine - ni valide, ni rejete"
        tone={unresolved > 0 ? "warning" : "default"}
      />
      <StatCard
        icon={<ChartIcon className="stat-icon" />}
        label="CDC recents (2020-2026)"
        value={recentUsable.toLocaleString("fr-FR")}
        description="Usables et prioritaires pour le traitement"
        tone="ai"
      />
      <StatCard
        icon={<ChartIcon className="stat-icon" />}
        label="CDC anciens (avant 2020)"
        value={olderUsable.toLocaleString("fr-FR")}
        description="Usables, priorite secondaire"
      />
      <StatCard
        icon={<DatabaseIcon className="stat-icon" />}
        label="Rattaches a un lot de revue"
        value={linkedToCompletedBatch.toLocaleString("fr-FR")}
        description="Candidats relies a un import de revue humaine termine"
      />
      <StatCard
        icon={<ClockIcon className="stat-icon" />}
        label="Extraction des 21 critères"
        value="Non démarrée"
        description="L'extraction des 21 critères CDC n'a pas encore commencé pour les CDC validés"
      />
    </section>
  );
}
