"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserAvatar } from "./user-avatar.tsx";
import { UserStatusBadge } from "./user-status-badge.tsx";
import type { UserRecord } from "@/lib/users/types.ts";
import { getUserRoleLabel } from "@/lib/auth/rbac.ts";
import { setUserStatus, UsersClientError } from "@/lib/users/client.ts";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR");
}

export function UserDetailView({ user }: { user: UserRecord }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleStatusToggle() {
    startTransition(() => {
      void (async () => {
        setFeedback(null);
        setError(null);

        try {
          await setUserStatus(user.id, user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
          setFeedback(user.status === "ACTIVE" ? "Utilisateur desactive." : "Utilisateur active.");
          router.refresh();
        } catch (requestError) {
          setError(
            requestError instanceof UsersClientError
              ? requestError.message
              : "La mise a jour du statut utilisateur a echoue."
          );
        }
      })();
    });
  }

  return (
    <div className="grid">
      <section className="section-card user-detail-hero-card">
        <div className="section-body user-detail-hero-body">
          <div className="user-detail-identity">
            <UserAvatar
              firstName={user.firstName}
              lastName={user.lastName}
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              size="lg"
            />
            <div className="user-detail-copy">
              <h2>{user.displayName}</h2>
              <p>{user.jobTitle || getUserRoleLabel(user.role)}</p>
              <div className="profile-badges">
                <span className="badge">{getUserRoleLabel(user.role)}</span>
                <span className="badge">{user.departmentName}</span>
                <UserStatusBadge status={user.status} />
              </div>
            </div>
          </div>

          <div className="user-detail-actions">
            <Link
              href={`/administration/utilisateurs/${user.id}/modifier`}
              className="button button-primary"
            >
              Modifier l'utilisateur
            </Link>
            <button
              type="button"
              className={user.status === "ACTIVE" ? "button button-danger-outline" : "button button-secondary"}
              disabled={isPending}
              onClick={handleStatusToggle}
            >
              {user.status === "ACTIVE" ? "Desactiver" : "Activer"}
            </button>
          </div>
        </div>
      </section>

      {feedback ? <div className="callout info">{feedback}</div> : null}
      {error ? <div className="callout warning">{error}</div> : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Coordonnees et preferences</h3>
            <p className="meta">Vue detaillee du profil utilisateur et de ses parametres de fonctionnement.</p>
          </div>
        </div>
        <div className="section-body">
          <dl className="detail-grid">
            <div className="detail-item">
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div className="detail-item">
              <dt>Telephone</dt>
              <dd>{user.phone ?? "Non renseigne"}</dd>
            </div>
            <div className="detail-item">
              <dt>Departement</dt>
              <dd>{user.departmentName}</dd>
            </div>
            <div className="detail-item">
              <dt>Role</dt>
              <dd>{getUserRoleLabel(user.role)}</dd>
            </div>
            <div className="detail-item">
              <dt>Langue</dt>
              <dd>{user.language}</dd>
            </div>
            <div className="detail-item">
              <dt>Fuseau horaire</dt>
              <dd>{user.timezone}</dd>
            </div>
            <div className="detail-item">
              <dt>Derniere connexion</dt>
              <dd>{formatDateTime(user.lastLoginAt)}</dd>
            </div>
            <div className="detail-item">
              <dt>Cree le</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
            <div className="detail-item">
              <dt>Mis a jour le</dt>
              <dd>{formatDateTime(user.updatedAt)}</dd>
            </div>
            <div className="detail-item">
              <dt>Avatar URL</dt>
              <dd>{user.avatarUrl ?? "Non renseignee"}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
