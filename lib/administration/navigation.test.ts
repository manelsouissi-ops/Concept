import test from "node:test";
import assert from "node:assert/strict";
import {
  filterNavigationByRole,
  getAdminNavigationSections,
  getAiToolsNavigation,
  isActiveNavigationPath,
  type NavigationItemDefinition
} from "./navigation.ts";
import { USER_ROLES } from "../auth/rbac.ts";

const SAMPLE_SIDEBAR_ITEMS: NavigationItemDefinition[] = [
  { label: "Tableau de bord", href: "/dashboard", iconKey: "dashboard", area: "dashboard" },
  { label: "Appels d'offres", href: "/appels-offres", iconKey: "folder", area: "appels_offres" },
  { label: "Administration", href: "/administration", iconKey: "settings", area: "administration" },
  { label: "Utilisateurs", href: "/administration/utilisateurs", iconKey: "user", area: "administration" },
  { label: "Referentiels", iconKey: "library", disabled: true, area: "administration" }
];

test("admin sidebar exposes only technical navigation groups", () => {
  const sections = getAdminNavigationSections();
  const hrefs = sections.flatMap((section) => section.items.map((item) => item.href));

  assert.deepEqual(
    sections.map((section) => section.label),
    ["Administration", "Gestion", "Configuration", "Outils IA", "Compte"]
  );
  assert.equal(hrefs.includes("/administration"), true);
  assert.equal(hrefs.includes("/administration/utilisateurs"), true);
  assert.equal(hrefs.includes("/administration/logiciels"), true);
  assert.equal(hrefs.includes("/settings"), true);
  assert.equal(hrefs.includes("/profile"), true);
  assert.equal(hrefs.includes("/outils/pseudonymisation"), true);
  assert.equal(hrefs.includes("/dashboard"), false);
  assert.equal(hrefs.includes("/appels-offres"), false);
});

// A. Every role (including ADMIN, via getAdminNavigationSections) sees both
// "Assistant IA" and "Pseudonymisation" - the tools carry no `area`, so
// filterNavigationByRole cannot hide them for any role.
test("getAiToolsNavigation exposes Assistant IA and Pseudonymisation to every role", () => {
  for (const role of USER_ROLES) {
    const visible = filterNavigationByRole(
      getAiToolsNavigation("http://localhost:3002"),
      role
    );
    const labels = visible.map((item) => item.label);

    assert.deepEqual(labels, ["Assistant IA", "Pseudonymisation"]);
  }
});

test("admin Outils IA section carries the same two items as the shared list", () => {
  const sections = getAdminNavigationSections("http://localhost:3002");
  const outilsIaSection = sections.find((section) => section.label === "Outils IA");

  assert.ok(outilsIaSection);
  assert.deepEqual(
    outilsIaSection!.items.map((item) => item.label),
    ["Assistant IA", "Pseudonymisation"]
  );
});

// B. Assistant IA's href comes straight from the configured URL and is
// marked external (opens in a new tab, no client-side route highlighting).
// When unset, it must degrade to disabled rather than link nowhere.
test("Assistant IA item uses the configured URL and is marked external", () => {
  const [assistantIa] = getAiToolsNavigation("http://localhost:3002");

  assert.equal(assistantIa.label, "Assistant IA");
  assert.equal(assistantIa.href, "http://localhost:3002");
  assert.equal(assistantIa.external, true);
  assert.equal(assistantIa.disabled, false);
});

test("Assistant IA item is disabled instead of broken when no URL is configured", () => {
  const [assistantIa] = getAiToolsNavigation(null);

  assert.equal(assistantIa.disabled, true);
  assert.equal(assistantIa.href, undefined);
});

test("Pseudonymisation item is an internal route, not external", () => {
  const [, pseudonymisation] = getAiToolsNavigation("http://localhost:3002");

  assert.equal(pseudonymisation.label, "Pseudonymisation");
  assert.equal(pseudonymisation.href, "/outils/pseudonymisation");
  assert.equal(pseudonymisation.external, undefined);
});

test("admin navigation active route matching keeps the current technical page highlighted", () => {
  assert.equal(isActiveNavigationPath("/administration", "/administration"), true);
  assert.equal(
    isActiveNavigationPath("/administration/utilisateurs/nouveau", "/administration/utilisateurs"),
    true
  );
  assert.equal(isActiveNavigationPath("/dashboard", "/administration"), false);
  assert.equal(
    isActiveNavigationPath("/dashboard", "/dashboard?section=dossiers", "section=dossiers"),
    true
  );
  assert.equal(
    isActiveNavigationPath("/dashboard", "/dashboard?section=modules", "section=dossiers"),
    false
  );
});

test("business roles never receive Administration nav items, not even disabled", () => {
  for (const role of ["COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const) {
    const visible = filterNavigationByRole(SAMPLE_SIDEBAR_ITEMS, role);
    const labels = visible.map((item) => item.label);

    assert.deepEqual(labels, ["Tableau de bord", "Appels d'offres"]);
    assert.equal(labels.includes("Administration"), false);
    assert.equal(labels.includes("Utilisateurs"), false);
    assert.equal(labels.includes("Referentiels"), false);
  }
});

test("ADMIN sees Administration nav items but not the business primary nav", () => {
  const visible = filterNavigationByRole(SAMPLE_SIDEBAR_ITEMS, "ADMIN");
  const labels = visible.map((item) => item.label);

  assert.deepEqual(labels, ["Administration", "Utilisateurs", "Referentiels"]);
  assert.equal(labels.includes("Tableau de bord"), false);
  assert.equal(labels.includes("Appels d'offres"), false);
});
