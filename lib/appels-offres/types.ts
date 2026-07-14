import type { StatusPayload } from "../types.ts";

export type AppelOffresStatus =
  | "draft"
  | "processing"
  | "ready"
  | "error"
  | "archived";

export type AppelOffresBusinessStatus =
  | "brouillon"
  | "cdc_importe"
  | "en_attente_analyse"
  | "analyse_en_cours"
  | "fiche_a_valider"
  | "fiche_validee"
  | "erreur"
  | "archive";

export type AppelOffresSource = "manual" | "fiche-flow";

export type AppelOffresPriorite = "basse" | "normale" | "haute" | "critique";

export type DocumentKind =
  | "source_pdf"
  | "fiche_xml"
  | "fiche_markdown"
  | "status_json";

export type ProcessingJobStatus =
  | "created"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

export type ProcessingJobCallbackStatus = "completed" | "failed" | "cancelled";

export type ProcessingJobErrorStage =
  | "webhook"
  | "upload"
  | "marker"
  | "markdown"
  | "anonymization"
  | "llm"
  | "xml"
  | "callback"
  | "unknown";

export type ProcessingJobType =
  | "appel_offres_upload"
  | "appel_offres_update"
  | "fiche_generation";

export type AppelOffresInput = {
  code: string;
  title: string;
  reference: string;
  buyer: string;
  country: string;
  dueDate: string | null;
  notes: string;
  priorite: AppelOffresPriorite;
  responsableCommercial: string;
};

export type AppelOffresRecord = AppelOffresInput & {
  id: number;
  status: AppelOffresStatus;
  businessStatus: AppelOffresBusinessStatus | null;
  source: AppelOffresSource;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DocumentRecord = {
  id: number;
  appelOffresId: number;
  kind: DocumentKind;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingJobRecord = {
  id: number;
  appelOffresId: number;
  publicId: string | null;
  jobType: ProcessingJobType;
  status: ProcessingJobStatus;
  startedAt: string;
  finishedAt: string | null;
  contractVersion: string | null;
  correlationId: string | null;
  executionId: string | null;
  launchAcceptedAt: string | null;
  callbackReceivedAt: string | null;
  callbackStatus: ProcessingJobCallbackStatus | null;
  callbackIdempotencyKey: string | null;
  retryOfJobId: number | null;
  errorStage: ProcessingJobErrorStage | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
};

export type AuditLogRecord = {
  id: number;
  appelOffresId: number | null;
  action: string;
  details: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
};

export type ArtifactPresence = {
  hasSourcePdf: boolean;
  hasFicheXml: boolean;
  hasFicheMarkdown: boolean;
  hasStatusJson: boolean;
};

export type AppelOffresDetail = AppelOffresRecord & {
  documents: DocumentRecord[];
  latestJob: ProcessingJobRecord | null;
  processingJobs: ProcessingJobRecord[];
  auditLogs: AuditLogRecord[];
  artifacts: ArtifactPresence;
  ficheStatus: StatusPayload | null;
};

export type ListAppelsOffresFilters = {
  search?: string;
  status?: string;
  priorite?: string;
  pays?: string;
  client?: string;
  archived?: "true" | "false" | "all";
  sort?: string;
};

export type UpsertDocumentInput = {
  kind: DocumentKind;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
};
