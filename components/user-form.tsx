"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { createUser, updateUser, UsersClientError } from "@/lib/users/client.ts";
import type { DepartmentRecord, UserMutationInput, UserRecord } from "@/lib/users/types.ts";
import { USER_ROLES, getUserRoleLabel } from "@/lib/auth/rbac.ts";
import { USER_STATUSES } from "@/lib/users/types.ts";
import { getUserStatusLabel } from "@/lib/users/presentation.ts";

type Props = {
  mode: "create" | "edit";
  departments: DepartmentRecord[];
  user?: UserRecord | null;
};

function createInitialState(user?: UserRecord | null): UserMutationInput {
  return {
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    email: user?.email ?? "",
    jobTitle: user?.jobTitle ?? "",
    departmentCode: user?.departmentCode ?? "COMMERCIAL",
    role: user?.role ?? "COMMERCIAL",
    status: user?.status ?? "INVITED",
    avatarUrl: user?.avatarUrl ?? null,
    phone: user?.phone ?? null,
    language: user?.language ?? "fr-FR",
    timezone: user?.timezone ?? "Europe/Paris"
  };
}

export function UserForm({ mode, departments, user }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<UserMutationInput>(createInitialState(user));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const cancelHref = useMemo(() => {
    if (mode === "create") {
      return "/administration/utilisateurs";
    }

    return `/administration/utilisateurs/${user?.id ?? ""}`;
  }, [mode, user?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isWorking) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsWorking(true);

    try {
      const response =
        mode === "create"
          ? await createUser(form)
          : await updateUser(user?.id ?? 0, form);

      if (mode === "create") {
        router.push(`/administration/utilisateurs/${response.user.id}`);
        return;
      }

      setSuccess("Utilisateur mis a jour.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof UsersClientError
          ? requestError.message
          : "Enregistrement utilisateur impossible."
      );
    } finally {
      setIsWorking(false);
    }
  }

  function updateField<Key extends keyof UserMutationInput>(key: Key, value: UserMutationInput[Key]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  return (
    <form className="grid" onSubmit={handleSubmit}>
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Identite et organisation</h3>
            <p className="meta">
              Renseignez les informations de reference de l'utilisateur, son rattachement et ses droits.
            </p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="user-first-name">Prenom</label>
              <input
                id="user-first-name"
                className="input"
                value={form.firstName}
                disabled={isWorking}
                onChange={(event) => updateField("firstName", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-last-name">Nom</label>
              <input
                id="user-last-name"
                className="input"
                value={form.lastName}
                disabled={isWorking}
                onChange={(event) => updateField("lastName", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-email">Email</label>
              <input
                id="user-email"
                className="input"
                type="email"
                value={form.email}
                disabled={isWorking}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-phone">Telephone</label>
              <input
                id="user-phone"
                className="input"
                value={form.phone ?? ""}
                disabled={isWorking}
                onChange={(event) => updateField("phone", event.target.value || null)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-job-title">Fonction</label>
              <input
                id="user-job-title"
                className="input"
                value={form.jobTitle}
                disabled={isWorking}
                onChange={(event) => updateField("jobTitle", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-avatar-url">Avatar URL</label>
              <input
                id="user-avatar-url"
                className="input"
                value={form.avatarUrl ?? ""}
                disabled={isWorking}
                onChange={(event) => updateField("avatarUrl", event.target.value || null)}
              />
              <span className="hint">Optionnel. Si ce champ reste vide, les initiales seront affichees.</span>
            </div>

            <div className="field">
              <label htmlFor="user-department">Departement</label>
              <select
                id="user-department"
                className="select"
                value={form.departmentCode}
                disabled={isWorking}
                onChange={(event) =>
                  updateField("departmentCode", event.target.value as UserMutationInput["departmentCode"])
                }
              >
                {departments.map((department) => (
                  <option key={department.code} value={department.code}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="user-role">Role</label>
              <select
                id="user-role"
                className="select"
                value={form.role}
                disabled={isWorking}
                onChange={(event) => updateField("role", event.target.value as UserMutationInput["role"])}
              >
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {getUserRoleLabel(role)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="user-status">Statut</label>
              <select
                id="user-status"
                className="select"
                value={form.status}
                disabled={isWorking}
                onChange={(event) =>
                  updateField("status", event.target.value as UserMutationInput["status"])
                }
              >
                {USER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {getUserStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="user-language">Langue</label>
              <input
                id="user-language"
                className="input"
                value={form.language}
                disabled={isWorking}
                onChange={(event) => updateField("language", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="user-timezone">Fuseau horaire</label>
              <input
                id="user-timezone"
                className="input"
                value={form.timezone}
                disabled={isWorking}
                onChange={(event) => updateField("timezone", event.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="callout warning">{error}</div> : null}
      {success ? <div className="callout info">{success}</div> : null}

      <div className="actions">
        <button className="button button-primary" type="submit" disabled={isWorking}>
          {mode === "create" ? "Creer l'utilisateur" : "Enregistrer les modifications"}
        </button>
        <Link href={cancelHref} className="button button-ghost">
          Annuler
        </Link>
      </div>
    </form>
  );
}
