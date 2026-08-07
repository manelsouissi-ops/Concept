"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MoreHorizontalIcon } from "./app-icons.tsx";
import { EmptyState } from "./empty-state.tsx";
import { UserAvatar } from "./user-avatar.tsx";
import { UserStatusBadge } from "./user-status-badge.tsx";
import type { DepartmentRecord, UserRecord } from "@/lib/users/types.ts";
import { getUserRoleLabel, USER_ROLES } from "@/lib/auth/rbac.ts";
import { USER_STATUSES } from "@/lib/users/types.ts";
import {
  getUserOwnershipImpact,
  setUserStatus,
  UsersClientError
} from "@/lib/users/client.ts";
import { getUserStatusLabel } from "@/lib/users/presentation.ts";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function UserListView({
  users,
  departments
}: {
  users: UserRecord[];
  departments: DepartmentRecord[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRecord["role"]>("all");
  const [departmentFilter, setDepartmentFilter] = useState<"all" | UserRecord["departmentCode"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | UserRecord["status"]>("all");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr-FR");

    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }

      if (departmentFilter !== "all" && user.departmentCode !== departmentFilter) {
        return false;
      }

      if (statusFilter !== "all" && user.status !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        user.displayName,
        user.email,
        user.jobTitle,
        user.departmentName,
        getUserRoleLabel(user.role)
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR");

      return haystack.includes(normalizedQuery);
    });
  }, [departmentFilter, query, roleFilter, statusFilter, users]);

  function handleStatusToggle(user: UserRecord) {
    startTransition(() => {
      void (async () => {
        setError(null);
        setFeedback(null);
        try {
          if (user.role === "COMMERCIAL" && user.status === "ACTIVE") {
            const ownershipImpact = await getUserOwnershipImpact(user.id);
            if (ownershipImpact.activeOwnedCount > 0) {
              const dossierCount = ownershipImpact.activeOwnedCount;
              const preview = ownershipImpact.ownedTenderCodes.slice(0, 3).join(", ");
              const suffix =
                ownershipImpact.ownedTenderCodes.length > 3 ? ", ..." : "";
              const confirmed = window.confirm(
                `Ce Commercial possede ${dossierCount} dossier(s) actif(s) (${preview}${suffix}). `
                + "La desactivation placera ces dossiers dans la file de reaffectation. Continuer ?"
              );

              if (!confirmed) {
                return;
              }
            }
          }

          await setUserStatus(user.id, user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
          setFeedback(
            user.status === "ACTIVE"
              ? "Utilisateur desactive."
              : "Utilisateur reactive."
          );
          router.refresh();
        } catch (requestError) {
          setError(
            requestError instanceof UsersClientError
              ? requestError.message
              : "La mise a jour du statut a echoue."
          );
        }
      })();
    });
  }

  if (!users.length) {
    return (
      <EmptyState
        title="Aucun utilisateur n'est encore disponible."
        description="Commencez par creer un premier profil pour l'organisation."
        action={
          <Link href="/administration/utilisateurs/nouveau" className="button button-primary">
            Creer un utilisateur
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack">
      <section className="toolbar-card">
        <div className="toolbar-grid user-toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={query}
              placeholder="Nom, email, fonction ou departement"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <label className="toolbar-field">
            <span>Role</span>
            <select
              className="select"
              value={roleFilter}
              onChange={(event) =>
                setRoleFilter(event.target.value as "all" | UserRecord["role"])
              }
            >
              <option value="all">Tous</option>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {getUserRoleLabel(role)}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Departement</span>
            <select
              className="select"
              value={departmentFilter}
              onChange={(event) =>
                setDepartmentFilter(event.target.value as "all" | UserRecord["departmentCode"])
              }
            >
              <option value="all">Tous</option>
              {departments.map((department) => (
                <option key={department.code} value={department.code}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Statut</span>
            <select
              className="select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | UserRecord["status"])
              }
            >
              <option value="all">Tous</option>
              {USER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getUserStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>

          <div className="logiciels-result-count" aria-live="polite">
            {filteredUsers.length} utilisateur{filteredUsers.length > 1 ? "s" : ""}
          </div>
        </div>
      </section>

      {feedback ? <div className="callout info">{feedback}</div> : null}
      {error ? <div className="callout warning">{error}</div> : null}

      {!filteredUsers.length ? (
        <EmptyState
          compact
          title="Aucun resultat"
          description="Aucun utilisateur ne correspond aux filtres actuellement selectionnes."
        />
      ) : null}

      {filteredUsers.length ? (
        <section className="data-card table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Avatar</th>
                  <th>Nom</th>
                  <th>Email</th>
                  <th>Departement</th>
                  <th>Role</th>
                  <th>Statut</th>
                  <th>Cree</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <UserAvatar
                        firstName={user.firstName}
                        lastName={user.lastName}
                        displayName={user.displayName}
                        avatarUrl={user.avatarUrl}
                        size="sm"
                      />
                    </td>
                    <td>
                      <div className="table-primary-cell">
                        <strong>{user.displayName}</strong>
                        <span>{user.jobTitle || getUserRoleLabel(user.role)}</span>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>{user.departmentName}</td>
                    <td>{getUserRoleLabel(user.role)}</td>
                    <td>
                      <UserStatusBadge status={user.status} />
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>
                      <div className="table-actions">
                        <Link
                          href={`/administration/utilisateurs/${user.id}`}
                          className="button button-ghost button-small"
                        >
                          Ouvrir
                        </Link>
                        <details className="row-menu">
                          <summary className="row-menu-trigger" aria-label="Plus d'actions">
                            <MoreHorizontalIcon className="table-menu-icon" />
                          </summary>
                          <div className="row-menu-content">
                            <Link
                              href={`/administration/utilisateurs/${user.id}/modifier`}
                              className="row-menu-link"
                            >
                              Modifier
                            </Link>
                            <button
                              type="button"
                              className="row-menu-link destructive"
                              disabled={isPending}
                              onClick={() => handleStatusToggle(user)}
                            >
                              {user.status === "ACTIVE" ? "Desactiver" : "Activer"}
                            </button>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
