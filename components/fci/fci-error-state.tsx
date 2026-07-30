export function FciErrorState({
  title = "Workspace FCI indisponible",
  message,
  onRetry
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="empty-state-card">
      <div className="empty-state-copy">
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <div className="empty-state-actions">
          <button type="button" className="button button-secondary" onClick={onRetry}>
            Réessayer
          </button>
        </div>
      ) : null}
    </section>
  );
}
