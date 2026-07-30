type DashboardHealthSlice = {
  key: string;
  label: string;
  value: number;
  tone: "danger" | "warning" | "ai" | "neutral" | "success";
};

const TONE_STROKES: Record<DashboardHealthSlice["tone"], string> = {
  danger: "var(--status-error)",
  warning: "var(--status-warning)",
  ai: "var(--brand-purple-500)",
  neutral: "var(--text-muted)",
  success: "var(--brand-green-600)"
};

export function DashboardHealthDonut({
  total,
  slices
}: {
  total: number;
  slices: DashboardHealthSlice[];
}) {
  const visibleSlices = slices.filter((slice) => slice.value > 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const summary =
    visibleSlices.length > 0
      ? visibleSlices.map((slice) => `${slice.label}: ${slice.value}`).join(", ")
      : "Aucune repartition disponible";

  return (
    <div className="dashboard-donut-layout">
      <div
        className="dashboard-donut-visual"
        role="img"
        aria-label={`Repartition des dossiers. Total: ${total}. ${summary}.`}
      >
        <svg viewBox="0 0 120 120" className="dashboard-donut-svg" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="rgba(24, 36, 47, 0.08)"
            strokeWidth="12"
          />
          <g transform="rotate(-90 60 60)">
            {visibleSlices.map((slice) => {
              const length = total > 0 ? (slice.value / total) * circumference : 0;
              const dasharray = `${length} ${circumference - length}`;
              const dashoffset = -offset;
              offset += length;

              return (
                <circle
                  key={slice.key}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke={TONE_STROKES[slice.tone]}
                  strokeWidth="12"
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  strokeLinecap="butt"
                />
              );
            })}
          </g>
        </svg>
        <div className="dashboard-donut-center">
          <strong>{total}</strong>
          <span>dossiers</span>
        </div>
      </div>

      <ul className="dashboard-donut-legend">
        {slices.map((slice) => (
          <li key={slice.key} className="dashboard-donut-legend-item">
            <span
              className={`dashboard-donut-swatch tone-${slice.tone}`}
              aria-hidden="true"
            />
            <span className="dashboard-donut-legend-label">{slice.label}</span>
            <strong className="dashboard-donut-legend-value">{slice.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
