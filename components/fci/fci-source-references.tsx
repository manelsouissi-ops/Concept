import type { FciAiSourceReference } from "@/lib/appels-offres/fci/ai-contracts.ts";

export function FciSourceReferences({
  references
}: {
  references: FciAiSourceReference[];
}) {
  if (!references.length) {
    return null;
  }

  return (
    <div className="fci-source-references">
      <span className="fci-metadata-label">Références source</span>
      <ul>
        {references.map((reference, index) => (
          <li key={`${reference.section}:${reference.field}:${index}`}>
            <strong>{reference.section}</strong>
            <span>{reference.field}</span>
            {reference.excerpt ? <small>{reference.excerpt}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
