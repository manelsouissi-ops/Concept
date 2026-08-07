import type { ReactNode } from "react";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

// The auth gate must run in the layout, not just page.tsx: this segment has a
// sibling loading.tsx, which makes Next.js stream a 200 shell before the page
// component's own redirect() could take effect. A layout renders above that
// Suspense boundary, so its redirect() commits before any streaming starts.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireAreaAccessForPage("dashboard");
  return children;
}
