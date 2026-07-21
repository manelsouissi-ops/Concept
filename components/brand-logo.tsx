import Image from "next/image";

export function BrandLogo({
  compact = false,
  priority = false
}: {
  compact?: boolean;
  priority?: boolean;
}) {
  return (
    <div className={compact ? "brand-logo compact" : "brand-logo"}>
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
      <div className="brand-logo-copy">
        <strong>CONCEPT</strong>
        <span>Gestion intelligente des appels d&apos;offres</span>
      </div>
    </div>
  );
}
