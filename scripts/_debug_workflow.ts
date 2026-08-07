import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { serializeFiche } from "../lib/fiche-xml.ts";
import { DATA_ROOT, createDraftBundle, markFicheValidated } from "../lib/storage.ts";
import { EVALUATION_FIELD_DEFINITIONS, EXTRACTION_FIELD_DEFINITIONS } from "../lib/types.ts";
import { createAppelOffres, ensureAppelsOffresSchema, getAppelOffresRecordByCode, closeAppelsOffresPool } from "../lib/appels-offres/repository.ts";
import { ensureFciSchema, closeFciPool } from "../lib/appels-offres/fci/repository.ts";
import { getSeededActors } from "../lib/appels-offres/test-actors.ts";
import { initializeFciWorkspace } from "../lib/appels-offres/fci/service.ts";
import { closeUsersPool } from "../lib/users/repository.ts";
import { closeNotificationsPool } from "../lib/notifications/repository.ts";
import { closeWorkflowPool } from "../lib/appels-offres/workflow/repository.ts";
import { assignCommercialOwner } from "../lib/appels-offres/ownership.ts";

function buildFichePayload(code: string) {
  return {
    codeInterne: code,
    extraction: EXTRACTION_FIELD_DEFINITIONS.map((field) => ({ key: field.key, label: field.label, value: `${field.label} ${code}`, source: "test" })),
    evaluation: EVALUATION_FIELD_DEFINITIONS.map((field, index) => ({ key: field.key, label: field.label, score: 3 + (index % 2), justification: `${field.label} justification`, chargeEstimee: field.key === "risque_sous_dimensionnement" ? "Charge test" : undefined })),
    controle: { champsNonTrouves: [], incoherences: [], aVerifier: [], resolutions: [] }
  };
}

async function main() {
  const code = `AO-WF-DEBUG-${randomUUID().slice(0, 8).toUpperCase()}`;
  await ensureAppelsOffresSchema();
  await ensureFciSchema();
  await fs.mkdir(DATA_ROOT, { recursive: true });

  await createAppelOffres({
    code, title: `AO ${code}`, reference: "", buyer: "Client test", country: "SN",
    dueDate: null, notes: "", priorite: "normale", responsableCommercial: "Claire Martin",
    status: "ready", businessStatus: "fiche_validee", source: "manual"
  });

  const before = await getAppelOffresRecordByCode(code);
  console.log("before initializeFciWorkspace, commercialOwnerUserId=", before?.commercialOwnerUserId);

  const payload = buildFichePayload(code);
  const xml = serializeFiche(payload, { referenceInterne: code });
  await createDraftBundle({ codeInterne: code, pdfFile: new File(["%PDF-1.7 test"], "cdc.pdf", { type: "application/pdf" }), xml, markdown: `# ${code}` });
  await markFicheValidated(code);

  const actors = await getSeededActors();
  console.log("commercial actor id:", actors.commercial.id, actors.commercial.role);
  await initializeFciWorkspace(code, actors.commercial);

  const after = await getAppelOffresRecordByCode(code);
  console.log("after initializeFciWorkspace, commercialOwnerUserId=", after?.commercialOwnerUserId);

  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(actors.commercial.id),
    currentUser: actors.commercial,
    reason: "workflow_test_setup"
  });
  console.log("assignCommercialOwner succeeded");

  const afterAssign = await getAppelOffresRecordByCode(code);
  console.log("after assignCommercialOwner, commercialOwnerUserId=", afterAssign?.commercialOwnerUserId);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await closeAppelsOffresPool();
  await closeFciPool();
  await closeUsersPool();
  await closeNotificationsPool();
  await closeWorkflowPool();
});
