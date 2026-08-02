"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfile, UsersClientError } from "@/lib/users/client.ts";
import type { DepartmentRecord, ProfileUpdateInput, UserRecord } from "@/lib/users/types.ts";
import { UserAvatar } from "./user-avatar.tsx";
import { UserStatusBadge } from "./user-status-badge.tsx";
import { getUserRoleLabel } from "@/lib/auth/rbac.ts";

function createInitialState(user: UserRecord): ProfileUpdateInput {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    jobTitle: user.jobTitle,
    departmentCode: user.departmentCode,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    language: user.language,
    timezone: user.timezone
  };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Jamais";
  }

  return new Date(value).toLocaleString("fr-FR");
}

export function ProfileForm({
  user,
  departments
}: {
  user: UserRecord;
  departments: DepartmentRecord[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProfileUpdateInput>(() => createInitialState(user));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  function updateField<Key extends keyof ProfileUpdateInput>(
    key: Key,
    value: ProfileUpdateInput[Key]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isWorking) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsWorking(true);

    try {
      await updateProfile(form);
      setSuccess("Profil mis a jour.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof UsersClientError
          ? requestError.message
          : "La mise a jour du profil a echoue."
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <form className="grid" onSubmit={handleSubmit}>
      <section className="section-card profile-hero-card">
        <div className="section-body profile-hero-body">
          <div className="profile-identity">
            <UserAvatar
              firstName={user.firstName}
              lastName={user.lastName}
              displayName={user.displayName}
              avatarUrl={form.avatarUrl}
              size="lg"
            />
            <div className="profile-identity-copy">
              <h2>{user.displayName}</h2>
              <p>{user.jobTitle || getUserRoleLabel(user.role)}</p>
              <div className="profile-badges">
                <span className="badge">{getUserRoleLabel(user.role)}</span>
                <span className="badge">{user.departmentName}</span>
                <UserStatusBadge status={user.status} />
              </div>
            </div>
          </div>

          <div className="profile-summary-grid">
            <div className="profile-summary-item">
              <span>Derniere connexion</span>
              <strong>{formatDateTime(user.lastLoginAt)}</strong>
            </div>
            <div className="profile-summary-item">
              <span>Compte cree le</span>
              <strong>{formatDateTime(user.createdAt)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Informations du profil</h3>
            <p className="meta">
              Le role et le statut sont geres par l'administration. Les autres informations peuvent etre mises a jour ici.
            </p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="profile-first-name">Prenom</label>
              <input
                id="profile-first-name"
                className="input"
                value={form.firstName}
                disabled={isWorking}
                onChange={(event) => updateField("firstName", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-last-name">Nom</label>
              <input
                id="profile-last-name"
                className="input"
                value={form.lastName}
                disabled={isWorking}
                onChange={(event) => updateField("lastName", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-email">Email</label>
              <input
                id="profile-email"
                className="input"
                type="email"
                value={form.email}
                disabled={isWorking}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-phone">Telephone</label>
              <input
                id="profile-phone"
                className="input"
                value={form.phone ?? ""}
                disabled={isWorking}
                onChange={(event) => updateField("phone", event.target.value || null)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-job-title">Fonction</label>
              <input
                id="profile-job-title"
                className="input"
                value={form.jobTitle}
                disabled={isWorking}
                onChange={(event) => updateField("jobTitle", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-department">Departement</label>
              <select
                id="profile-department"
                className="select"
                value={form.departmentCode}
                disabled={isWorking}
                onChange={(event) =>
                  updateField("departmentCode", event.target.value as ProfileUpdateInput["departmentCode"])
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
              <label htmlFor="profile-avatar-url">Avatar URL</label>
              <input
                id="profile-avatar-url"
                className="input"
                value={form.avatarUrl ?? ""}
                disabled={isWorking}
                onChange={(event) => updateField("avatarUrl", event.target.value || null)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-language">Langue</label>
              <input
                id="profile-language"
                className="input"
                value={form.language}
                disabled={isWorking}
                onChange={(event) => updateField("language", event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="profile-timezone">Fuseau horaire</label>
              <input
                id="profile-timezone"
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
          Enregistrer mon profil
        </button>
      </div>
    </form>
  );
}
