"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { DashboardRowActionButton } from "@/components/dashboard-row-action-button.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";
import type { DashboardRowAction } from "@/lib/appels-offres/dashboard-status.ts";

type DashboardRecentAppel = {
  code: string;
  title: string;
  client: string;
  statusLabel: string;
  statusTone: BadgeTone;
  nextAction: DashboardRowAction;
};

export function DashboardRecentAppelsTable({
  items
}: {
  items: DashboardRecentAppel[];
}) {
  const router = useRouter();

  function openWorkspace(code: string) {
    router.push(`/appels-offres/${encodeURIComponent(code)}`);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWorkspace(code);
    }
  }

  return (
    <>
      <div className="dashboard-recent-list-desktop">
        <div className="dashboard-recent-grid dashboard-recent-grid-header" aria-hidden="true">
          <span>Code</span>
          <span>Intitule</span>
          <span>Client</span>
          <span>Statut</span>
          <span>Action</span>
        </div>

        <div className="dashboard-recent-list">
          {items.map((item) => (
            <article
              key={item.code}
              className="dashboard-recent-grid dashboard-recent-grid-row"
              tabIndex={0}
              role="link"
              aria-label={`Ouvrir ${item.code}`}
              onClick={() => openWorkspace(item.code)}
              onKeyDown={(event) => handleRowKeyDown(event, item.code)}
            >
              <span className="mono dashboard-recent-grid-code" title={item.code}>
                {item.code}
              </span>
              <strong className="dashboard-recent-grid-title" title={item.title}>
                {item.title}
              </strong>
              <span className="dashboard-recent-grid-client" title={item.client}>
                {item.client}
              </span>
              <span className="dashboard-recent-grid-status">
                <StatusBadge label={item.statusLabel} tone={item.statusTone} />
              </span>
              <span
                className="dashboard-recent-grid-action"
                onClick={(event) => event.stopPropagation()}
              >
                <DashboardRowActionButton action={item.nextAction} />
              </span>
            </article>
          ))}
        </div>
      </div>

      <div className="dashboard-recent-mobile-list">
        {items.map((item) => (
          <article
            key={item.code}
            className="dashboard-recent-mobile-item"
            tabIndex={0}
            role="link"
            aria-label={`Ouvrir ${item.code}`}
            onClick={() => openWorkspace(item.code)}
            onKeyDown={(event) => handleRowKeyDown(event, item.code)}
          >
            <div className="dashboard-recent-mobile-topline">
              <div>
                <span className="card-kicker mono" title={item.code}>
                  {item.code}
                </span>
                <strong title={item.title}>{item.title}</strong>
              </div>
              <StatusBadge label={item.statusLabel} tone={item.statusTone} />
            </div>
            <span className="meta">{item.client}</span>
            <div
              className="dashboard-recent-mobile-actions"
              onClick={(event) => event.stopPropagation()}
            >
              <DashboardRowActionButton action={item.nextAction} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
