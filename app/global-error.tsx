"use client";

import "./globals.css";

export default function GlobalError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body>
        <main className="auth-page">
          <section className="auth-card auth-card-centered">
            <div className="auth-card-copy">
              <span className="badge">Erreur</span>
              <h1>La plateforme est indisponible</h1>
              <p>Une erreur inattendue a interrompu le chargement. Vous pouvez reessayer.</p>
            </div>

            <div className="auth-card-actions">
              <button type="button" className="button button-primary" onClick={() => reset()}>
                Reessayer
              </button>
              <a href="/" className="button button-secondary">
                Retour au tableau de bord
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
