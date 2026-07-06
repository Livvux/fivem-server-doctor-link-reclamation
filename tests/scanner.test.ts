import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { sha256 } from "../src/hash.js";
import { applyFix, proposeFixes, scan } from "../src/scanner.js";
import type { DoctorConfig } from "../src/types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fivem-doctor-"));
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test("scan ranks missing resources, manifest problems, dependencies, logs, and redacts secrets", async () => {
  const fixture = await createFixture();
  const result = await scan(fixture.config);
  const ids = result.findings.map((finding) => finding.id);

  assert.equal(result.resources.some((resource) => resource.name === "badmanifest"), true);
  assert.equal(result.resources.some((resource) => resource.name === "missingmanifest"), true);
  assertIncludes(ids, "server_cfg.missing_resource.missing_resource");
  assertIncludes(ids, "resource.missingmanifest.missing_manifest");
  assertIncludes(ids, "manifest.badmanifest.missing_fx_version");
  assertIncludes(ids, "manifest.badmanifest.missing_game");
  assertIncludes(ids, "manifest.badmanifest.missing_file.server_lua");
  assertIncludes(ids, "manifest.badmanifest.missing_dependency.oxmysql");
  assertIncludes(ids, "logs.missing_license_key");
  assertIncludes(ids, "logs.port_bind_failed");
  assertIncludes(ids, "logs.resource_not_found");
  assertIncludes(ids, "logs.manifest_parse_error");
  assert.equal(JSON.stringify(result).includes("cfxk_realSecret"), false);
});

test("applyFix refuses writes unless enabled and creates a backup on exact hash match", async () => {
  const resourceDir = path.join(tempDir, "resources", "repair");
  await fs.promises.mkdir(resourceDir, { recursive: true });
  const manifestPath = path.join(resourceDir, "fxmanifest.lua");
  const original = "game 'gta5'\nserver_script 'server.lua'\n";
  await fs.promises.writeFile(manifestPath, original);

  const config: DoctorConfig = {
    resources: path.join(tempDir, "resources"),
    allowWrite: false,
  };
  const fix = (await proposeFixes(config)).find((candidate) =>
    candidate.id.startsWith("prepend_manifest_line.repair.fx_version"),
  );
  assert.ok(fix);
  assert.equal(fix.beforeHash, sha256(original));

  const disabled = await applyFix(config, fix.id, fix.beforeHash ?? undefined);
  assert.equal(disabled.applied, false);
  assert.match(disabled.message, /Writes are disabled/);
  assert.equal(await fs.promises.readFile(manifestPath, "utf8"), original);

  const enabled = await applyFix({ ...config, allowWrite: true }, fix.id, fix.beforeHash ?? undefined);
  assert.equal(enabled.applied, true);
  assert.equal(enabled.file, manifestPath);
  assert.ok(enabled.backupPath);
  assert.equal(await fs.promises.readFile(enabled.backupPath, "utf8"), original);
  assert.match(await fs.promises.readFile(manifestPath, "utf8"), /^fx_version 'cerulean'\n/);
});

test("applyFix rejects stale generated hashes", async () => {
  const resourceDir = path.join(tempDir, "resources", "stale");
  await fs.promises.mkdir(resourceDir, { recursive: true });
  const manifestPath = path.join(resourceDir, "fxmanifest.lua");
  await fs.promises.writeFile(manifestPath, "game 'gta5'\n");
  const config: DoctorConfig = {
    resources: path.join(tempDir, "resources"),
    allowWrite: true,
  };
  const fix = (await proposeFixes(config)).find((candidate) =>
    candidate.id.startsWith("prepend_manifest_line.stale.fx_version"),
  );
  assert.ok(fix);
  await fs.promises.writeFile(manifestPath, "game 'gta5'\nname 'changed'\n");

  const result = await applyFix(config, fix.id, fix.beforeHash ?? undefined);
  assert.equal(result.applied, false);
  assert.match(result.message, /Expected hash|changed|not found/i);
});

async function createFixture(): Promise<{ config: DoctorConfig }> {
  const resources = path.join(tempDir, "resources");
  const txdata = path.join(tempDir, "txData", "default");
  await fs.promises.mkdir(path.join(resources, "[standalone]", "badmanifest"), { recursive: true });
  await fs.promises.mkdir(path.join(resources, "[standalone]", "missingmanifest"), { recursive: true });
  await fs.promises.mkdir(path.join(txdata, "logs"), { recursive: true });

  await fs.promises.writeFile(
    path.join(tempDir, "server.cfg"),
    [
      "sv_licenseKey cfxk_realSecret",
      "ensure badmanifest",
      "ensure missingmanifest",
      "ensure missing_resource",
    ].join("\n"),
  );
  await fs.promises.writeFile(
    path.join(resources, "[standalone]", "badmanifest", "fxmanifest.lua"),
    "server_script 'server.lua'\ndependency 'oxmysql'\n",
  );
  await fs.promises.writeFile(
    path.join(txdata, "logs", "fxserver.log"),
    [
      "No license key specified: sv_licenseKey cfxk_realSecret",
      "Couldn't find resource missing_resource.",
      "Could not parse resource metadata file fxmanifest.lua: expected name",
      "Error: listen EADDRINUSE: address already in use 0.0.0.0:30120",
    ].join("\n"),
  );

  return {
    config: {
      serverCfg: path.join(tempDir, "server.cfg"),
      resources,
      txdata,
      allowWrite: false,
    },
  };
}

function assertIncludes<T>(actual: T[], expected: T): void {
  assert.equal(actual.includes(expected), true, `Expected ${String(expected)} in ${JSON.stringify(actual)}`);
}
