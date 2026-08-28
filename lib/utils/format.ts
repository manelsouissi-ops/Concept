export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  
  if (bytes < 1024) return `${bytes} o`;
  
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let unitIndex = 0;
  let size = bytes;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDate(date: string | null | undefined): string {
  if (date === null || date === undefined) return "—";
  
  // Try to parse the date
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return "—";
  
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}