import test from "node:test";
import assert from "node:assert/strict";
import { findSoftwareMatchCandidate } from "./software-analysis-matching.ts";
import type { SoftwareRecord } from "../administration/logiciels/types.ts";

const catalogue: SoftwareRecord[] = [
  {
    id: 1,
    name: "Autocad",
    normalizedName: "autocad",
    descriptionRaw: "DAO",
    status: "active",
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    aliases: []
  },
  {
    id: 2,
    name: "HECRAS",
    normalizedName: "hecras",
    descriptionRaw: "Hydraulique",
    status: "active",
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    aliases: [
      {
        id: 20,
        softwareId: 2,
        alias: "Hec-Ras",
        normalizedAlias: "hec-ras",
        source: "manual",
        createdAt: "2026-07-22T10:00:00.000Z"
      }
    ]
  }
];

test("findSoftwareMatchCandidate detects exact normalized software names", () => {
  const match = findSoftwareMatchCandidate("AUTOCAD", catalogue);

  assert.equal(match.matchType, "exact");
  assert.equal(match.software?.id, 1);
  assert.equal(match.validatedByUser, true);
});

test("findSoftwareMatchCandidate detects alias matches", () => {
  const match = findSoftwareMatchCandidate("Hec-Ras", catalogue);

  assert.equal(match.matchType, "alias");
  assert.equal(match.software?.id, 2);
  assert.equal(match.validatedByUser, true);
});

test("findSoftwareMatchCandidate proposes conservative possible matches without auto-validation", () => {
  const match = findSoftwareMatchCandidate("HEC RAS", catalogue);

  assert.equal(match.matchType, "possible");
  assert.equal(match.software?.id, 2);
  assert.equal(match.validatedByUser, false);
});

test("findSoftwareMatchCandidate returns none when no catalogue entry is plausible", () => {
  const match = findSoftwareMatchCandidate("Logiciel inconnu", catalogue);

  assert.equal(match.matchType, "none");
  assert.equal(match.software, null);
  assert.equal(match.validatedByUser, false);
});
