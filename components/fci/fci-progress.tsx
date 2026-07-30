export function FciProgress({
  validatedModules,
  totalModules,
  percentage
}: {
  validatedModules: number;
  totalModules: number;
  percentage: number;
}) {
  return (
    <section className="workspace-card compact">
      <div className="workspace-card-topline">
        <div>
          <span className="card-kicker">Progression</span>
          <h3>{validatedModules} modules valides</h3>
        </div>
        <strong>{percentage}%</strong>
      </div>
      <div className="fci-progress-bar" aria-hidden="true">
        <span style={{ width: `${percentage}%` }} />
      </div>
      <p className="workspace-card-description">
        {validatedModules} / {totalModules} modules actives ont ete validees.
      </p>
    </section>
  );
}
