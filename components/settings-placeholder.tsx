import Link from "next/link";

type SettingsSection = {
  label: string;
  href: string;
  description: string;
  comingSoon?: boolean;
};

export function SettingsPlaceholder({
  title,
  description,
  activeSection,
  sections
}: {
  title: string;
  description: string;
  activeSection: string;
  sections: readonly SettingsSection[];
}) {
  return (
    <div className="page-stack">
      <section className="section-card">
        <div className="section-body settings-layout">
          <aside className="settings-nav">
            <h3>Parametres</h3>
            <div className="settings-nav-list">
              {sections.map((section) =>
                section.comingSoon ? (
                  <span
                    key={section.href}
                    className={activeSection === section.href ? "settings-nav-link active disabled" : "settings-nav-link disabled"}
                    aria-disabled="true"
                  >
                    <span>{section.label}</span>
                    <small>Bientot</small>
                  </span>
                ) : (
                  <Link
                    key={section.href}
                    href={section.href}
                    className={activeSection === section.href ? "settings-nav-link active" : "settings-nav-link"}
                  >
                    <span>{section.label}</span>
                  </Link>
                )
              )}
            </div>
          </aside>

          <div className="settings-content">
            <header className="settings-content-header">
              <h2>{title}</h2>
              <p>{description}</p>
            </header>

            <section className="data-card">
              <div className="section-body stack">
                <div className="callout info">
                  Cette section est prete pour l'integration avec l'authentification, les preferences par utilisateur et les controles de securite avances.
                </div>

                <div className="settings-grid">
                  {sections.map((section) => (
                    <div key={section.href} className="settings-card">
                      <strong>{section.label}</strong>
                      <p>{section.description}</p>
                      {section.comingSoon ? <span className="badge">Bientot</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
