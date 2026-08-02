import { getUserInitials } from "@/lib/users/presentation.ts";

export function UserAvatar({
  firstName,
  lastName,
  displayName,
  avatarUrl,
  size = "md"
}: {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const initials = getUserInitials({ firstName, lastName, displayName }) || "??";
  const className = ["user-avatar", `user-avatar-${size}`].join(" ");

  if (avatarUrl) {
    return (
      <span className={className} aria-hidden="true">
        <img src={avatarUrl} alt="" className="user-avatar-image" />
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      {initials}
    </span>
  );
}
