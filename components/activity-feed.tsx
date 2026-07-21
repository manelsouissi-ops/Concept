import type { WorkspaceActivityItem } from "@/lib/appels-offres/workspace.ts";

export function ActivityFeed({
  items
}: {
  items: WorkspaceActivityItem[];
}) {
  return (
    <div className="activity-feed">
      {items.map((item) => (
        <article key={item.id} className={`activity-item tone-${item.tone}`}>
          <div className="activity-item-dot" aria-hidden="true" />
          <div className="activity-item-copy">
            <strong>{item.label}</strong>
            <span>{new Date(item.createdAt).toLocaleString("fr-FR")}</span>
            {item.actor ? <small>Par {item.actor}</small> : null}
            {item.description ? <p>{item.description}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
