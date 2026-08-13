import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("topbar user-menu summary keeps phrasing-only content", () => {
  const source = readFileSync(path.join(process.cwd(), "components/app-shell.tsx"), "utf8");

  assert.match(
    source,
    /<summary className="topbar-user-button"[\s\S]*?<span className="topbar-user-copy">[\s\S]*?<\/span>[\s\S]*?<\/summary>/,
    "topbar user-menu summary should keep only phrasing content so React does not warn about invalid HTML nesting"
  );
  assert.doesNotMatch(
    source,
    /<summary className="topbar-user-button"[\s\S]*?<div className="topbar-user-copy">/,
    "topbar user-menu summary must not contain a block <div>"
  );
});

test("tender creation topbar actions use the canonical creation permission", () => {
  const source = readFileSync(path.join(process.cwd(), "components/app-shell.tsx"), "utf8");
  assert.match(source, /canCreateTender\(currentUser\.role/);
  assert.match(source, /routeAction\?\.href === "\/appels-offres\/nouveau"/);
});
