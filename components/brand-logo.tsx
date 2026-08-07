import Image from "next/image";

export function BrandLogo({
  compact = false,
  priority = false,
  showCopy = true
}: {
  compact?: boolean;
  priority?: boolean;
  showCopy?: boolean;
}) {
  return (
    <div
      className={[
        "brand-logo",
        compact ? "compact" : null,
        showCopy ? null : "mark-only"
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="brand-logo-frame">
        <Image
          src="/concept-logo.png"
          alt="CONCEPT Engineering & Management"
          width={112}
          height={112}
          className="brand-logo-image"
          priority={priority}
        />
      </div>
      {showCopy ? (
        <div className="brand-logo-copy">
          <strong>CONCEPT</strong>
          <span>Gestion intelligente des appels d&apos;offres</span>
        </div>
      ) : null}
    </div>
  );
}
