import { buildAppelOffresSummary, isNearDeadline } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import { buildWorkspaceActivityFeed } from "./workspace.ts";

function compareRecent(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export async function getDashboardData() {
  const details = await listAppelOffresDetails({ archived: "all" });
  const summaries = details.map(buildAppelOffresSummary);

  const activeSummaries = summaries.filter((item) => item.statusKey !== "archive");
  const activeDetails = details.filter((detail) => detail.archivedAt == null);

  const recentAppelsOffres = activeDetails
    .slice()
    .sort(compareRecent)
    .slice(0, 6)
    .map((detail) => ({
      detail,
      summary: buildAppelOffresSummary(detail)
    }));

  const recentActivity = details
    .flatMap((detail) =>
      buildWorkspaceActivityFeed(detail).map((entry) => ({
        id: entry.id,
        code: detail.code,
        title: detail.title,
        label: entry.label,
        actor: entry.actor,
        createdAt: entry.createdAt,
        description: entry.description,
        tone: entry.tone
      }))
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);

  return {
    total_appels_offres: activeSummaries.length,
    brouillons: activeSummaries.filter((item) => item.statusKey === "brouillon").length,
    en_attente_analyse: activeSummaries.filter(
      (item) => item.statusKey === "cdc_importe" || item.statusKey === "en_attente_analyse"
    ).length,
    analyses_en_cours: activeSummaries.filter((item) => item.statusKey === "analyse_en_cours").length,
    fiches_cdc_a_valider: activeSummaries.filter((item) => item.statusKey === "fiche_a_valider").length,
    fiches_cdc_validees: activeSummaries.filter((item) => item.statusKey === "fiche_validee").length,
    erreurs_traitement: activeSummaries.filter((item) => item.statusKey === "erreur").length,
    archives: summaries.filter((item) => item.statusKey === "archive").length,
    recent_appels_offres: recentAppelsOffres,
    actions_requises: {
      fiches_cdc_a_valider: activeDetails
        .filter((detail) => buildAppelOffresSummary(detail).statusKey === "fiche_a_valider")
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        })),
      analyses_en_erreur: activeDetails
        .filter((detail) => buildAppelOffresSummary(detail).statusKey === "erreur")
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        })),
      appels_proches_date_limite: activeDetails
        .filter((detail) => isNearDeadline(detail))
        .map((detail) => ({
          code: detail.code,
          title: detail.title,
          dueDate: detail.dueDate
        })),
      fci_en_attente: activeDetails
        .filter((detail) => buildAppelOffresSummary(detail).statusKey === "fiche_validee")
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        }))
    },
    recent_activity: recentActivity
  };
}
