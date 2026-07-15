export function PlaceholderPanel({
  title,
  description,
  badge = "Bientôt disponible"
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <section className="placeholder-panel">
      <div className="placeholder-panel-badge">{badge}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </section>
  );
}
