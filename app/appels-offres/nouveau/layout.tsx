import type { ReactNode } from "react";
import { requireTenderCreationAccessForPage } from "@/lib/auth/server.ts";

// This gate sits above nouveau/loading.tsx so denied roles are redirected
// before Next.js can stream the creation shell.
export default async function NouvelAppelOffresLayout({ children }: { children: ReactNode }) {
  await requireTenderCreationAccessForPage();
  return children;
}
