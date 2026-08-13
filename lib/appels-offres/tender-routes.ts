export const TENDER_WORKSPACE_ROUTE_VIEWS = [
  "overview",
  "documents",
  "fiche-cdc",
  "fci",
  "go-no-go",
  "history"
] as const;

export type TenderWorkspaceRouteView = (typeof TENDER_WORKSPACE_ROUTE_VIEWS)[number];

const TENDER_WORKSPACE_ROUTE_VIEW_SET = new Set<string>(TENDER_WORKSPACE_ROUTE_VIEWS);

export function isTenderWorkspaceRouteView(value: string): value is TenderWorkspaceRouteView {
  return TENDER_WORKSPACE_ROUTE_VIEW_SET.has(value);
}

export function buildTenderWorkspaceHref(code: string, view: TenderWorkspaceRouteView) {
  return `/appels-offres/${encodeURIComponent(code)}/${view}`;
}
