import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";

export function StatusBadge({
  label,
  tone = "neutral",
  className = ""
}: {
  label: string;
  tone?: BadgeTone;
  className?: string;
}) {
  const classes = ["status-badge", `status-badge-${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <span className="status-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
