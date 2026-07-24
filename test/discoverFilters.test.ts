import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const app = readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8");

test("Discover filters start clean and persist applied values in the page URL", () => {
  assert.match(app, /function getDiscoverFilters\(\)/);
  assert.match(app, /"all",\n\s*\),/);
  assert.match(
    app,
    /minimumScore: queryScore\(params\.get\("minimumScore"\)\)/,
  );
  assert.match(app, /function updateDiscoverFilterQuery\(filters\)/);
  assert.match(
    app,
    /history\.replaceState\(null, "", `\/discover\?\$\{params\.toString\(\)\}`\)/,
  );
  assert.match(app, /country: params\.get\("country"\) \|\| ""/);
  assert.match(app, /state\.profile\?\.targetCountries/);
});

test("Discover exposes a reset control and returns to a clean /discover URL", () => {
  assert.match(app, /data-reset-discover-filters/);
  assert.match(app, /function resetDiscoverFilters\(\)/);
  assert.match(app, /history\.pushState\(null, "", "\/discover"\)/);
});
