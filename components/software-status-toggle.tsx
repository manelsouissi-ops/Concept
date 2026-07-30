"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SoftwareRecord } from "@/lib/administration/logiciels/types.ts";

export function SoftwareStatusToggle({ software }: { software: SoftwareRecord }) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (isWorking) {
      return;
    }

    setError(null);
    setIsWorking(true);

    try {
      const response = await fetch(
        `/api/administration/logiciels/${software.id}/${software.status === "active" ? "archive" : "reactivate"}`,
        {
          method: "POST"
        }
      );
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Operation impossible.");
        return;
      }

      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Operation impossible.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="software-status-actions">
      <button
        type="button"
        className={software.status === "active" ? "button button-danger-ghost" : "button button-secondary"}
        onClick={() => void handleToggle()}
        disabled={isWorking}
      >
        {software.status === "active" ? "Archiver" : "Reactiver"}
      </button>
      {error ? <p className="meta software-inline-error">{error}</p> : null}
    </div>
  );
}
