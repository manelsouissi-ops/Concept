import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  metadata
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metadata?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <div className="page-header-title-row">
          <div className="page-header-title-block">
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="page-header-actions">{actions}</div> : null}
        </div>
        {metadata ? <div className="page-header-meta">{metadata}</div> : null}
      </div>
    </header>
  );
}
