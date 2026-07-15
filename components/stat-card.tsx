import Link from "next/link";
import type { ReactNode } from "react";

export function StatCard({
  icon,
  label,
  value,
  description,
  href,
  actionLabel
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  description: string;
  href?: string;
  actionLabel?: string;
}) {
  const content = (
    <>
      <div className="stat-card-topline">
        <span className="stat-card-icon">{icon}</span>
        <span className="stat-card-label">{label}</span>
      </div>
      <strong className="stat-card-value">{value}</strong>
      <p className="stat-card-description">{description}</p>
      {href && actionLabel ? <span className="stat-card-action">{actionLabel}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="stat-card interactive">
        {content}
      </Link>
    );
  }

  return <div className="stat-card">{content}</div>;
}
