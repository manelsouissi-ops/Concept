export function FciBlockedState({ onOpenFiche }: { onOpenFiche: () => void }) {
  return (
    <section className="section-card fci-blocked-state">
      <div className="section-body">
        <h3>Contributions FCI</h3>
        <p className="fci-blocked-message">En attente de validation de la Fiche CDC</p>
        <p className="meta">
          Les contributions FCI seront disponibles après validation de la Fiche CDC par le
          responsable commercial.
        </p>
        <div className="workspace-card-actions">
          <button type="button" className="button button-primary" onClick={onOpenFiche}>
            Ouvrir la Fiche CDC
          </button>
        </div>
      </div>
    </section>
  );
}
