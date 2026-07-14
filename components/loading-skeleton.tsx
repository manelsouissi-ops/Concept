export function LoadingSkeleton({
  title = "Chargement en cours"
}: {
  title?: string;
}) {
  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-header-copy">
          <span className="page-eyebrow">Chargement</span>
          <div className="page-header-title-row">
            <div className="page-header-title-block">
              <h1>{title}</h1>
              <p>La page se prépare avec les données disponibles.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="data-card">
        <div className="section-body">
          <div className="skeleton-grid">
            <div className="skeleton-block tall" />
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
        </div>
      </section>
    </div>
  );
}
