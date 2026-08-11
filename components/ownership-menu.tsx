"use client";

import { useEffect, useState } from "react";
import type { UserRecord } from "@/lib/users/types.ts";

type OwnershipPayload = {
  owner: {
    userId: number | null;
    displayName: string | null;
    jobTitle: string | null;
    assignedAt: string | null;
    assignedByName: string | null;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

async function readJsonOrThrow(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    ownership?: OwnershipPayload;
    users?: UserRecord[];
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Operation impossible.");
  }

  return payload;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

/**
 * Small, collapsed "Responsable commercial" panel for the tender overview.
 * Replaces the dominant ownership section that used to live at the top of
 * the Overview tab - the assign/transfer action is still available, just
 * tucked behind a disclosure rather than taking a whole section.
 */
export function OwnershipMenu({ code }: { code: string }) {
  const [ownership, setOwnership] = useState<OwnershipPayload | null>(null);
  const [eligibleOwners, setEligibleOwners] = useState<UserRecord[]>([]);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const [ownershipResponse, eligibleResponse] = await Promise.all([
        fetch(`/api/appels-offres/${encodeURIComponent(code)}/owner`, { cache: "no-store" }),
        fetch("/api/commercial/owners/eligible", { cache: "no-store" })
      ]);
      const ownershipPayload = await readJsonOrThrow(ownershipResponse);
      const eligiblePayload = await readJsonOrThrow(eligibleResponse);
      setOwnership(ownershipPayload.ownership ?? null);
      setEligibleOwners(eligiblePayload.users ?? []);
      setSelectedOwnerUserId(String(ownershipPayload.ownership?.owner.userId ?? ""));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    }
  }

  useEffect(() => {
    if (isOpen && !ownership) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function handleConfirm() {
    const nextOwnerUserId = Number(selectedOwnerUserId);
    if (!Number.isInteger(nextOwnerUserId) || nextOwnerUserId < 1) {
      setError("Selectionnez un responsable commercial actif.");
      return;
    }

    const hasOwner = ownership?.owner.userId != null;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/appels-offres/${encodeURIComponent(code)}/owner/${hasOwner ? "transfer" : "assign"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_owner_user_id: nextOwnerUserId, reason: null })
        }
      );
      await readJsonOrThrow(response);
      setMessage(hasOwner ? "Le dossier a ete transfere." : "Le dossier a ete attribue.");
      await load();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details
      className="ownership-menu"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="button button-ghost button-small">
        {ownership?.owner.displayName ?? "Gérer le responsable"}
      </summary>
      <div className="ownership-menu-content">
        {error ? <div className="callout warning">{error}</div> : null}
        {message ? <div className="callout info">{message}</div> : null}
        <div className="workspace-info-row">
          <span>Attribué le</span>
          <strong>{formatDateTime(ownership?.owner.assignedAt)}</strong>
        </div>
        <div className="workspace-info-row">
          <span>Attribué par</span>
          <strong>{ownership?.owner.assignedByName ?? "Non renseigné"}</strong>
        </div>
        <select
          className="input"
          value={selectedOwnerUserId}
          onChange={(event) => setSelectedOwnerUserId(event.target.value)}
        >
          <option value="">Selectionner un Commercial</option>
          {eligibleOwners.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => void handleConfirm()}
          disabled={isSubmitting}
        >
          {ownership?.owner.userId ? "Transférer le dossier" : "Attribuer un responsable"}
        </button>
      </div>
    </details>
  );
}
