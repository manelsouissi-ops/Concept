import Link from "next/link";
import type { CommercialWorkspacePresentation } from "@/lib/appels-offres/commercial-workspace.ts";

const QUICK_ACCESS_LINKS = [
  { label: "Appels d'offres", href: "/appels-offres" },
  { label: "Mes Fiches CDC", href: "/fiches-cdc" },
  { label: "Mes FCI", href: "/mes-fci" },
  { label: "Go/No-Go", href: "/go-no-go" }
];

// A static reminder of the CONCEPT process - intentionally not derived from
// tender state. It is a visual anchor, not a status table.
const WORKFLOW_STEPS = ["CDC", "FCI A · B · C", "Go/No-Go", "Direction Générale"];

export function CommercialWorkspace({ workspace }: { workspace: CommercialWorkspacePresentation }) {
  const hasAnyTender = (workspace.kpis.find((item) => item.key === "active")?.value ?? 0) > 0;

  return (
    <div className="page-stack commercial-dashboard">
      <header className="commercial-dashboard-welcome">
        <div>
          <h1>Bonjour {workspace.currentUser.firstName} 👋</h1>
          <p>
            {hasAnyTender
              ? "Bienvenue dans votre espace Commercial."
              : "Bienvenue dans CONCEPT. Commencez par créer votre premier appel d’offres."}
          </p>
          {hasAnyTender ? (
            <p className="commercial-welcome-sub">
              Suivez l’avancement de vos appels d’offres et accédez rapidement à vos prochaines actions.
            </p>
          ) : null}
          <Link href="/appels-offres/nouveau" className="button button-primary">
            + Nouvel appel d&apos;offres
          </Link>
        </div>
      </header>

      <section className="commercial-stats-row" aria-label="Statistiques">
        {workspace.kpis.map((item) => (
          <Link key={item.key} href={workspaceStatHref(item.key)} className="commercial-stat-cell">
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </Link>
        ))}
      </section>

      <section className="commercial-workflow-visual" aria-label="Étapes du processus CONCEPT">
        {WORKFLOW_STEPS.map((step, index) => (
          <div key={step} className="commercial-workflow-visual-step">
            <span>
              <i aria-hidden="true">{index === 0 ? "●" : "○"}</i>
              {step}
            </span>
            {index < WORKFLOW_STEPS.length - 1 ? <em aria-hidden="true">→</em> : null}
          </div>
        ))}
      </section>

      <section className="data-card commercial-next-actions">
        <div className="section-header">
          <div>
            <h2>Prochaines actions</h2>
          </div>
        </div>
        <div className="section-body">
          {workspace.nextActions.length ? (
            <div className="commercial-next-action-list">
              {workspace.nextActions.map((action, index) => (
                <article key={action.key} className="commercial-next-action-row">
                  <span className="commercial-next-action-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{action.title}</strong>
                    <p>{action.description}</p>
                  </div>
                  <Link href={action.href} className="commercial-next-action-link">
                    {action.linkLabel} →
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="commercial-all-clear">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Tout est à jour</strong>
                <p>Aucune action urgente pour le moment.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="commercial-dashboard-footer">
        {workspace.unownedQueue.length ? (
          <Link href="/appels-offres" className="commercial-unassigned-note">
            {workspace.unownedQueue.length} dossier{workspace.unownedQueue.length > 1 ? "s" : ""} à affecter · Voir les appels d&apos;offres →
          </Link>
        ) : <span />}

        <nav className="commercial-quick-access" aria-label="Accès rapide">
          <span>Accès rapide</span>
          {QUICK_ACCESS_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}

function workspaceStatHref(key: string) {
  switch (key) {
    case "active":
      return "/appels-offres";
    case "fiche-review":
      return "/fiches-cdc";
    case "fci-a":
      return "/mes-fci";
    case "ready":
    case "awaiting-dg":
      return "/go-no-go";
    default:
      return "/dashboard";
  }
}
