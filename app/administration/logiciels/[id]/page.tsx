import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareStatusToggle } from "@/components/software-status-toggle.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { getSoftwareById } from "@/lib/administration/logiciels/repository.ts";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("fr-FR");
}

export default async function SoftwareDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const softwareId = Number(id);

  if (!Number.isInteger(softwareId) || softwareId <= 0) {
    notFound();
  }

  const software = await getSoftwareById(softwareId);
  if (!software) {
    notFound();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={software.name}
        description="Consultez le logiciel de reference, son usage brut et les alias conserves pour les imports et futurs matchings."
        actions={
          <Link
            href={`/administration/logiciels/${software.id}/modifier`}
            className="button button-primary"
          >
            Modifier
          </Link>
        }
      />

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Vue d'ensemble</h3>
            <p className="meta">Informations metier exposees sans details techniques de base de donnees.</p>
          </div>
        </div>

        <div className="section-body stack">
          <div className="software-detail-grid">
            <div className="software-detail-block">
              <span className="software-detail-label">Statut</span>
              <StatusBadge
                label={software.status === "active" ? "Actif" : "Archive"}
                tone={software.status === "active" ? "success" : "neutral"}
              />
            </div>

            <div className="software-detail-block">
              <span className="software-detail-label">Creation</span>
              <strong>{formatTimestamp(software.createdAt)}</strong>
            </div>

            <div className="software-detail-block">
              <span className="software-detail-label">Derniere modification</span>
              <strong>{formatTimestamp(software.updatedAt)}</strong>
            </div>
          </div>

          <div className="software-detail-stack">
            <div className="software-detail-block">
              <span className="software-detail-label">Utilisation brute</span>
              <p>{software.descriptionRaw || "Non renseignee."}</p>
            </div>

            <div className="software-detail-block">
              <span className="software-detail-label">Alias</span>
              {software.aliases.length ? (
                <div className="software-alias-list">
                  {software.aliases.map((alias) => (
                    <span key={alias.id} className="software-alias-chip">
                      {alias.alias}
                    </span>
                  ))}
                </div>
              ) : (
                <p>Aucun alias enregistre.</p>
              )}
            </div>
          </div>

          <div className="actions">
            <Link
              href={`/administration/logiciels/${software.id}/modifier`}
              className="button button-secondary"
            >
              Modifier
            </Link>
            <SoftwareStatusToggle software={software} />
          </div>
        </div>
      </section>
    </div>
  );
}
