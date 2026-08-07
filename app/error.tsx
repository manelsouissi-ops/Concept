"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-centered">
        <div className="auth-card-copy">
          <span className="badge">Erreur</span>
          <h1>Une erreur est survenue</h1>
          <p>Quelque chose s&apos;est mal passe. Vous pouvez reessayer ou revenir a l&apos;accueil.</p>
        </div>

        <div className="auth-card-actions">
          <button type="button" className="button button-secondary" onClick={() => reset()}>
            Reessayer
          </button>
          <Link href="/" className="button button-primary">
            Retour au tableau de bord
          </Link>
        </div>
      </section>
    </main>
  );
}
