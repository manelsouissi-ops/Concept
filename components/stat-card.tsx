import Link from "next/link";
import type { ReactNode } from "react";

export function StatCard({
  icon,
  label,
  value,
  description,
  href,
  actionLabel,
  tone = "default",
  statusTone
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  description?: string;
  href?: string;
  actionLabel?: string;
  tone?: "default" | "success" | "ai" | "warning" | "danger";
  /** Small status dot in the topline. Omit when the metric has no health signal to show. */
  statusTone?: "success" | "warning" | "danger";
}) {
  const content = (
    <>
      <div className="stat-card-topline">
        <span className="stat-card-icon">{icon}</span>
        <span className="stat-card-label">{label}</span>
        {statusTone ? (
          <span
            className={`stat-card-status-dot stat-card-status-dot-${statusTone}`}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <strong className="stat-card-value">{value}</strong>
      {description ? <p className="stat-card-description">{description}</p> : null}
      {href && actionLabel ? <span className="stat-card-action">{actionLabel}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`stat-card interactive stat-card-${tone}`}>
        {content}
      </Link>
    );
  }

  return <div className={`stat-card stat-card-${tone}`}>{content}</div>;
}
