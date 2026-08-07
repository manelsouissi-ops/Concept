import Link from "next/link";
import { getOptionalCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";

export default async function ForbiddenPage() {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  const isTechnicalAdmin = currentUser?.role === "ADMIN";

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-centered">
        <div className="auth-card-copy">
          <span className="badge">403</span>
          <h1>Acces refuse</h1>
          <p>Cette fonctionnalite est reservee aux equipes metier.</p>
        </div>

        <div className="auth-card-actions">
          <Link
            href={isTechnicalAdmin ? "/administration" : "/dashboard"}
            className="button button-primary"
          >
            {isTechnicalAdmin ? "Retour a l'administration" : "Retour au tableau de bord"}
          </Link>
        </div>
      </section>
    </main>
  );
}
