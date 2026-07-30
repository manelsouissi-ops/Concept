import { Fragment } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  FileTextIcon,
  FolderIcon,
  UploadIcon
} from "@/components/app-icons.tsx";
import type { WorkspaceActivityItem } from "@/lib/appels-offres/workspace.ts";

type ActivityFeedVariant = "compact" | "history";
type CompactDateMode = "absolute" | "relative";

function getDayKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDayHeading(value: string) {
  const now = new Date();
  const target = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const difference = Math.round((today - targetDay) / 86400000);

  if (difference === 0) {
    return "Aujourd'hui";
  }

  if (difference === 1) {
    return "Hier";
  }

  return target.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatActivityDateTime(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString("fr-FR")} a ${formatActivityTime(value)}`;
}

function formatRelativeCompactDateTime(value: string, nowReference: string) {
  const now = new Date(nowReference);
  const target = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const difference = Math.round((today - targetDay) / 86400000);
  const timeLabel = formatActivityTime(value);

  if (difference === 0) {
    return `Aujourd'hui · ${timeLabel}`;
  }

  if (difference === 1) {
    return `Hier · ${timeLabel}`;
  }

  return `${target.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  })} · ${timeLabel}`;
}

function getActivityIcon(item: WorkspaceActivityItem) {
  switch (item.kind) {
    case "created":
    case "archived":
    case "reopened":
      return FolderIcon;
    case "cdc_received":
    case "cdc_replaced":
      return UploadIcon;
    case "analysis_started":
    case "analysis_completed":
      return ClockIcon;
    case "analysis_failed":
      return AlertIcon;
    case "fiche_validated":
      return CheckCircleIcon;
    case "fiche_generated":
    case "fiche_modified":
    default:
      return FileTextIcon;
  }
}

function isFileDescription(item: WorkspaceActivityItem) {
  return item.kind === "cdc_received" || item.kind === "cdc_replaced";
}

function renderActivityItem(
  item: WorkspaceActivityItem,
  variant: ActivityFeedVariant,
  compactDateMode: CompactDateMode,
  nowReference: string,
  subtleIcons: boolean
) {
  const Icon = getActivityIcon(item);

  return (
    <article
      key={item.id}
      className={`activity-item is-${variant} tone-${item.tone} kind-${item.kind}${subtleIcons ? " subtle-icons" : ""}`}
    >
      {variant === "history" ? (
        <time className="activity-item-time" dateTime={item.createdAt}>
          {formatActivityTime(item.createdAt)}
        </time>
      ) : null}
      <div className="activity-item-icon-shell" aria-hidden="true">
        <Icon className="activity-item-icon" />
      </div>
      <div className="activity-item-copy">
        <div className="activity-item-topline">
          <strong>{item.label}</strong>
          {variant === "compact" ? (
            <span>
              {compactDateMode === "relative"
                ? formatRelativeCompactDateTime(item.createdAt, nowReference)
                : formatActivityDateTime(item.createdAt)}
            </span>
          ) : null}
        </div>
        {item.description ? (
          <p
            className={isFileDescription(item) ? "activity-item-description is-file" : "activity-item-description"}
            title={isFileDescription(item) ? item.description : undefined}
          >
            {item.description}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function ActivityFeed({
  items,
  variant = "compact",
  compactDateMode = "absolute",
  nowReference = "2026-07-22T12:00:00.000Z",
  subtleIcons = false
}: {
  items: WorkspaceActivityItem[];
  variant?: ActivityFeedVariant;
  compactDateMode?: CompactDateMode;
  nowReference?: string;
  subtleIcons?: boolean;
}) {
  if (variant === "history") {
    const groups = items.reduce<
      Array<{
        key: string;
        label: string;
        items: WorkspaceActivityItem[];
      }>
    >((result, item) => {
      const key = getDayKey(item.createdAt);
      const currentGroup = result[result.length - 1];

      if (!currentGroup || currentGroup.key !== key) {
        result.push({
          key,
          label: formatDayHeading(item.createdAt),
          items: [item]
        });
        return result;
      }

      currentGroup.items.push(item);
      return result;
    }, []);

    return (
      <div className="activity-feed is-history">
        {groups.map((group) => (
          <section key={group.key} className="activity-day-group">
            <h4 className="activity-day-heading">{group.label}</h4>
            <div className="activity-day-list">
              {group.items.map((item) =>
                renderActivityItem(item, "history", compactDateMode, nowReference, subtleIcons)
              )}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="activity-feed is-compact">
      {items.map((item) => (
        <Fragment key={item.id}>
          {renderActivityItem(item, "compact", compactDateMode, nowReference, subtleIcons)}
        </Fragment>
      ))}
    </div>
  );
}
