"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "./empty-state.tsx";
import { StatusBadge } from "./status-badge.tsx";
import type { CdcWorkspaceRow, FciWorkspaceRow, GoNoGoWorkspaceRow, HistoryWorkspaceRow, WorkspaceFilter } from "@/lib/appels-offres/commercial-secondary-workspaces.ts";
import { formatElapsedDuration } from "@/lib/appels-offres/cdc-processing-presentation.ts";

function Header({ title, description }: { title: string; description: string }) { return <header className="commercial-section-header"><h1>{title}</h1><p>{description}</p></header>; }
function Filters({ items, value, onChange }: { items: Array<[WorkspaceFilter, string, number?]>; value: WorkspaceFilter; onChange: (value: WorkspaceFilter) => void }) { return <div className="commercial-filter-bar" role="tablist">{items.map(([key, label, count]) => <button key={key} type="button" className={value === key ? "active" : ""} onClick={() => onChange(key)}>{label}{typeof count === "number" ? <span>{count}</span> : null}</button>)}</div>; }
function Summary({ items }: { items: Array<[string, number]> }) { return <section className="commercial-section-summary">{items.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</section>; }

export function CommercialCdcWorkspace({ rows, counts }: { rows: CdcWorkspaceRow[]; counts: { review: number; processing: number; validated: number } }) {
  const router = useRouter();
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasProcessingRows = rows.some((row) => row.processingStartedAt != null);
  useEffect(() => {
    if (!hasProcessingRows) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasProcessingRows]);
  useEffect(() => {
    if (!hasProcessingRows) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasProcessingRows, router]);
  const visible = filter === "all" ? rows : rows.filter(row => row.filter === filter);
  return <div className="page-stack commercial-section-workspace"><Header title="Mes Fiches CDC" description="Suivez les fiches générées, à vérifier ou déjà validées." /><Summary items={[["À vérifier", counts.review], ["En traitement / génération", counts.processing], ["Validées", counts.validated]]} /><section className="data-card"><Filters value={filter} onChange={setFilter} items={[["all", "Tous", rows.length], ["review", "À vérifier", counts.review], ["validated", "Validées", counts.validated], ["processing", "En traitement", counts.processing]]} /><div className="commercial-workspace-list">{visible.length ? visible.map(row => <article key={row.code} className="commercial-workspace-row cdc"><div><span className="mono">{row.code}</span><strong>{row.title}</strong><small>{row.client}</small></div><div><StatusBadge label={row.status} tone={row.tone} /><small>Mis à jour le {row.updatedAt}</small></div>{row.action ? <Link href={row.href} className="button button-secondary button-small">{row.action} →</Link> : row.processingStartedAt ? <span className="cdc-processing-compact"><i aria-hidden="true" />Analyse en cours · {formatElapsedDuration(row.processingStartedAt, nowMs)}</span> : <span className="meta">Traitement interrompu</span>}</article>) : <EmptyState compact title="Aucune fiche" description="Aucune Fiche CDC ne correspond à ce filtre." />}</div></section></div>;
}

export function CommercialFciWorkspace({ rows, counts }: { rows: FciWorkspaceRow[]; counts: { todo: number; inProgress: number; validated: number } }) {
  const [filter, setFilter] = useState<WorkspaceFilter>("all"); const visible = filter === "all" ? rows : rows.filter(row => row.filter === filter);
  return <div className="page-stack commercial-section-workspace"><Header title="Mes FCI" description="Complétez votre analyse commerciale et suivez l’avancement des contributions." /><Summary items={[["À compléter", counts.todo], ["En cours", counts.inProgress], ["Validées", counts.validated]]} /><section className="data-card"><Filters value={filter} onChange={setFilter} items={[["all", "Toutes", rows.length], ["todo", "À compléter", counts.todo], ["in_progress", "En cours", counts.inProgress], ["validated", "Validées", counts.validated]]} /><div className="commercial-workspace-list">{visible.length ? visible.map(row => <article key={row.code} className="commercial-workspace-row fci"><div><span className="mono">{row.code}</span><strong>{row.title}</strong><small>Échéance · {row.deadline}</small></div><div className="fci-lane"><span><b>A</b><StatusBadge label={row.aStatus} tone={row.aTone} /></span><span><b>B</b>{row.bStatus}</span><span><b>C</b>{row.cStatus}</span></div><span className={row.ficheAvailable ? "availability yes" : "availability"}>{row.ficheAvailable ? "✓ Fiche CDC disponible" : "Fiche CDC indisponible"}</span><Link href={row.href} className="button button-secondary button-small">{row.action} →</Link></article>) : <EmptyState compact title="Aucune FCI" description="Aucune FCI A ne correspond à ce filtre." />}</div></section></div>;
}

export function CommercialGoNoGoWorkspace({ rows, counts }: { rows: GoNoGoWorkspaceRow[]; counts: { ready: number; prepared: number; submitted: number; decided: number } }) {
  const [filter, setFilter] = useState<WorkspaceFilter>("all"); const visible = filter === "all" ? rows : rows.filter(row => row.filter === filter);
  return <div className="page-stack commercial-section-workspace"><Header title="Go/No-Go" description="Consolidez les dossiers prêts, poursuivez leur préparation et suivez les décisions." /><Summary items={[["Prêts à préparer", counts.ready], ["En préparation", counts.prepared], ["En attente DG", counts.submitted], ["Décidés", counts.decided]]} /><section className="data-card"><Filters value={filter} onChange={setFilter} items={[["all", "Tous", rows.length], ["ready", "Prêts", counts.ready], ["prepared", "En préparation", counts.prepared], ["submitted", "En attente DG", counts.submitted], ["decided", "Décidés", counts.decided]]} /><div className="commercial-workspace-list">{visible.length ? visible.map(row => <article key={row.code} className="commercial-workspace-row gonogo"><div><span className="mono">{row.code}</span><strong>{row.title}</strong><small>{row.client}</small></div><div className="gonogo-readiness">{row.filter === "decided" ? <><strong>Décision finale</strong><span>Historique conservé</span></> : <><strong>FCI {row.readiness}/4</strong><span>{row.readiness === 4 ? "✓ Quatre contributions validées" : "Contributions en cours"}</span></>}</div><div><strong>{row.reportStatus}</strong><small>{row.submissionStatus}</small></div>{row.decision ? <StatusBadge label={row.decision} tone={row.decision === "GO" ? "success" : "neutral"} /> : <span /> }<Link href={row.href} className="button button-secondary button-small">{row.action} →</Link></article>) : <EmptyState compact title="Aucun dossier" description="Aucun dossier Go/No-Go ne correspond à ce filtre." />}</div></section></div>;
}

export function CommercialHistoryWorkspace({ rows }: { rows: HistoryWorkspaceRow[] }) {
  const [filter, setFilter] = useState<WorkspaceFilter>("all"); const visible = filter === "all" ? rows : rows.filter(row => row.category === filter);
  const countFor = (category: WorkspaceFilter) => rows.filter(row => row.category === category).length;
  return <div className="page-stack commercial-section-workspace"><Header title="Historique" description="Consultez les principaux événements métier enregistrés sur vos appels d’offres." /><section className="data-card"><Filters value={filter} onChange={setFilter} items={[["all", "Tous", rows.length], ["fiche", "Fiche CDC", countFor("fiche")], ["fci", "FCI", countFor("fci")], ["gonogo", "Go/No-Go", countFor("gonogo")], ["decision", "Décisions", countFor("decision")]]} /><div className="commercial-history-stream">{visible.length ? visible.map(row => <article key={row.id} className="commercial-history-event"><time>{new Date(row.createdAt).toLocaleDateString("fr-FR")}<br /><small>{new Date(row.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></time><span className={`history-dot ${row.category} tone-${row.tone}`} /><div><strong>{row.eventTitle}</strong><span><Link href={row.href} className="mono">{row.code}</Link> · {row.title}</span>{row.description ? <small className="commercial-history-description">{row.description}</small> : null}<small>{row.actor}{row.result ? ` · ${row.result}` : ""}</small></div></article>) : <EmptyState compact title="Aucun événement" description="Aucun événement métier ne correspond à ce filtre." />}</div></section></div>;
}
