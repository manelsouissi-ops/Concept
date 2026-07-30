import { buildAppelOffresSummary, isNearDeadline } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import { buildWorkspaceActivityFeed, buildWorkspaceIdentity, isPlaceholderProjectTitle } from "./workspace.ts";
import { listFciOverallStatusesByAppelOffresCodes } from "./fci/repository.ts";
import {
  buildDashboardRowAction,
  buildDashboardStatusDisplay,
  isDossierBlocked,
  isDossierComplete,
  isDossierProcessing
} from "./dashboard-status.ts";

export {
  buildDashboardRowAction,
  buildDashboardStatusDisplay,
  type DashboardRowAction,
  type DashboardRowActionKind
} from "./dashboard-status.ts";

const DASHBOARD_TITLE_PENDING_EXTRACTION = "Titre en attente d'extraction";

function compareRecent(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export async function getDashboardData() {
  const details = await listAppelOffresDetails({ archived: "all" });
  const summaries = details.map(buildAppelOffresSummary);

  const activeSummaries = summaries.filter((item) => item.statusKey !== "archive");
  const activeDetails = details.filter((detail) => detail.archivedAt == null);

  const fciStatusByCode = await listFciOverallStatusesByAppelOffresCodes(
    activeDetails.map((detail) => detail.code)
  );
  const getFciStatus = (code: string) => fciStatusByCode.get(code) ?? null;

  const recentAppelsOffres = activeDetails
    .slice()
    .sort(compareRecent)
    .slice(0, 5)
    .map((detail) => {
      const summary = buildAppelOffresSummary(detail);
      const fciStatus = getFciStatus(detail.code);
      const titlePendingExtraction = isPlaceholderProjectTitle(detail.title, detail.code);

      return {
        detail,
        summary,
        fciStatus,
        displayTitle: titlePendingExtraction ? DASHBOARD_TITLE_PENDING_EXTRACTION : detail.title,
        clientLabel: buildWorkspaceIdentity(detail).clientLabel,
        statusDisplay: buildDashboardStatusDisplay(summary, fciStatus),
        nextAction: buildDashboardRowAction(detail.code, summary, fciStatus)
      };
    });

  const recentActivity = details
    .flatMap((detail) =>
      buildWorkspaceActivityFeed(detail).map((entry) => ({
        id: entry.id,
        code: detail.code,
        title: detail.title,
        kind: entry.kind,
        label: entry.label,
        actor: entry.actor,
        createdAt: entry.createdAt,
        description: entry.description,
        tone: entry.tone
      }))
    )
    .filter((entry) =>
      [
        "created",
        "cdc_received",
        "analysis_started",
        "analysis_failed",
        "fiche_generated",
        "fiche_validated"
      ].includes(entry.kind)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  const nouveaux = activeSummaries.filter((item) =>
    ["brouillon", "cdc_importe", "en_attente_analyse"].includes(item.statusKey)
  ).length;

  const analysesEnCours = activeSummaries.filter((item) =>
    isDossierProcessing(item, getFciStatus(item.code))
  ).length;

  const fichesCdcAValider = activeSummaries.filter((item) => item.statusKey === "fiche_a_valider").length;

  const termines = activeSummaries.filter((item) =>
    isDossierComplete(item, getFciStatus(item.code))
  ).length;

  // Kept for the /api/dashboard payload consumed by scripts/verify-business-data-flow.ts;
  // not surfaced as a KPI card (see RULE 3: no prominent error count on the dashboard).
  const erreursTraitement = activeSummaries.filter((item) => item.statusKey === "erreur").length;
  const archives = summaries.filter((item) => item.statusKey === "archive").length;

  return {
    total_appels_offres: activeSummaries.length,
    nouveaux,
    analyses_en_cours: analysesEnCours,
    fiches_cdc_a_valider: fichesCdcAValider,
    termines,
    erreurs_traitement: erreursTraitement,
    archives,
    recent_appels_offres: recentAppelsOffres,
    actions_requises: {
      fiches_cdc_a_valider: activeDetails
        .filter((detail) => buildAppelOffresSummary(detail).statusKey === "fiche_a_valider")
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        })),
      analyses_fci_a_generer: activeDetails
        .filter((detail) => {
          const summary = buildAppelOffresSummary(detail);
          if (summary.statusKey !== "fiche_validee") {
            return false;
          }
          const fciStatus = getFciStatus(detail.code);
          return fciStatus == null || fciStatus === "not_started" || fciStatus === "needs_review";
        })
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        })),
      dossiers_prets_pour_offre: activeDetails
        .filter((detail) => isDossierComplete(buildAppelOffresSummary(detail), getFciStatus(detail.code)))
        .map((detail) => ({
          code: detail.code,
          title: detail.title
        })),
      dossiers_a_verifier: activeDetails
        .filter((detail) => isDossierBlocked(buildAppelOffresSummary(detail), getFciStatus(detail.code)))
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
        }))
    },
    recent_activity: recentActivity
  };
}
