import Link from "next/link";
import { getOptionalCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";
import { getDefaultAuthenticatedPath } from "@/lib/auth/rbac.ts";

export default async function NotFoundPage() {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  const isTechnicalAdmin = currentUser?.role === "ADMIN";
  const href = currentUser ? getDefaultAuthenticatedPath(currentUser.role) : "/login";

  return (
    <main className="auth-page">
      <section className="auth-card auth-card-centered">
        <div className="auth-card-copy">
          <span className="badge">404</span>
          <h1>Page introuvable</h1>
          <p>Cette page n&apos;existe pas ou a ete deplacee.</p>
        </div>

        <div className="auth-card-actions">
          <Link href={href} className="button button-primary">
            {isTechnicalAdmin ? "Retour a l'administration" : "Retour au tableau de bord"}
          </Link>
        </div>
      </section>
    </main>
  );
}
