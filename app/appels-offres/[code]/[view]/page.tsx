import { notFound } from "next/navigation";
import { isTenderWorkspaceRouteView } from "@/lib/appels-offres/tender-routes.ts";
import AppelOffresDetailPage from "../page.tsx";

export default async function FocusedTenderWorkspacePage({
  params,
  searchParams
}: {
  params: Promise<{ code: string; view: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code, view } = await params;
  if (!isTenderWorkspaceRouteView(view)) notFound();
  const currentSearch = searchParams ? await searchParams : {};
  return AppelOffresDetailPage({
    params: Promise.resolve({ code }),
    searchParams: Promise.resolve({ ...currentSearch, view })
  });
}
