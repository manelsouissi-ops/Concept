import { StatusBadge } from "@/components/status-badge.tsx";
import {
  getFciFormStatusPresentation,
  getFciGenerationJobStatusPresentation,
  getFciModuleStatusPresentation,
  getFciOverallStatusPresentation
} from "@/lib/appels-offres/fci/ui.ts";
import type { FciModuleFormStatus } from "@/lib/appels-offres/fci/presentation.ts";
import type {
  FciGenerationJobStatus,
  FciModuleStatus,
  FciSetOverallStatus
} from "@/lib/appels-offres/fci/types.ts";

export function FciModuleStatusBadge({
  status
}: {
  status: FciModuleStatus;
}) {
  const presentation = getFciModuleStatusPresentation(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}

export function FciFormStatusBadge({
  status
}: {
  status: FciModuleFormStatus;
}) {
  const presentation = getFciFormStatusPresentation(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}

export function FciOverallStatusBadge({
  status
}: {
  status: FciSetOverallStatus;
}) {
  const presentation = getFciOverallStatusPresentation(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}

export function FciGenerationJobStatusBadge({
  status
}: {
  status: FciGenerationJobStatus;
}) {
  const presentation = getFciGenerationJobStatusPresentation(status);
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}
