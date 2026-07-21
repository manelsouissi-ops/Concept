export function AiBadge({
  label = "IA"
}: {
  label?: string;
}) {
  return <span className="ai-badge">{label}</span>;
}
