import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  compact = false
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "empty-state-card compact" : "empty-state-card"}>
      <div className="empty-state-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action ? <div className="empty-state-actions">{action}</div> : null}
    </section>
  );
}
