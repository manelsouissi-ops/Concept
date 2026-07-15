import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

function IconFrame({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v4h-7z" />
      <path d="M13 10h7v10h-7z" />
      <path d="M4 13h7v7H4z" />
    </IconFrame>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M3 7.5a2.5 2.5 0 0 1 2.5-2.5h4l2 2h7a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </IconFrame>
  );
}

export function PlusSquareIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </IconFrame>
  );
}

export function FileTextIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M7 3.5h7l4 4v13a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20.5v-15A2 2 0 0 1 8 3.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </IconFrame>
  );
}

export function LibraryIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M4 19h16" />
      <path d="M6 19V9l6-4 6 4v10" />
      <path d="M9 13h6" />
    </IconFrame>
  );
}

export function DatabaseIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
      <path d="M5 10.5v5C5 16.9 8.1 18 12 18s7-1.1 7-2.5v-5" />
    </IconFrame>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-7" />
    </IconFrame>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M6 17h12l-1.4-2.1a4 4 0 0 1-.6-2.2V10a4 4 0 1 0-8 0v2.7a4 4 0 0 1-.6 2.2z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </IconFrame>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.3-2.6H9.5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4.9l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z" />
    </IconFrame>
  );
}

export function UserCircleIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6.5 18a6.5 6.5 0 0 1 11 0" />
      <circle cx="12" cy="12" r="9" />
    </IconFrame>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.2-4.2" />
    </IconFrame>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </IconFrame>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </IconFrame>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M12 4l8 15H4z" />
      <path d="M12 9v4" />
      <path d="M12 16h.01" />
    </IconFrame>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.2 2.2 4.8-5.2" />
    </IconFrame>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <path d="M12 16V6" />
      <path d="M8.5 9.5L12 6l3.5 3.5" />
      <path d="M5 18.5h14" />
    </IconFrame>
  );
}

export function MoreHorizontalIcon({ className }: IconProps) {
  return (
    <IconFrame className={className}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}
