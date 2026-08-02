import { StatusBadge } from "@/components/status-badge.tsx";
import { getUserStatusLabel, getUserStatusTone } from "@/lib/users/presentation.ts";
import type { UserStatus } from "@/lib/users/types.ts";

export function UserStatusBadge({
  status,
  className = ""
}: {
  status: UserStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      label={getUserStatusLabel(status)}
      tone={getUserStatusTone(status)}
      className={className}
    />
  );
}
