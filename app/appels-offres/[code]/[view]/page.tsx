import { notFound } from "next/navigation";
import AppelOffresDetailPage from "../page.tsx";

const ROUTE_VIEWS = new Set(["overview", "fiche-cdc", "fci", "go-no-go", "history", "documents"]);

export default async function FocusedTenderWorkspacePage({
  params,
  searchParams
}: {
  params: Promise<{ code: string; view: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code, view } = await params;
  if (!ROUTE_VIEWS.has(view)) notFound();
  const currentSearch = searchParams ? await searchParams : {};
  return AppelOffresDetailPage({
    params: Promise.resolve({ code }),
    searchParams: Promise.resolve({ ...currentSearch, view })
  });
}
