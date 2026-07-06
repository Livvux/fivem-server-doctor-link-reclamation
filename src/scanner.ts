import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./hash.js";
import { dirExists, fileExists, isUnderRoots, rootsFor } from "./pathSafety.js";
import { redact, redactJson } from "./redact.js";
import type {
  DoctorConfig,
  Finding,
  FixCandidate,
  ResourceSummary,
  ScanResult,
  Severity,
} from "./types.js";

type EnsureEntry = {
  command: "ensure" | "start";
  resource: string;
  line: number;
};

type ManifestInspection = {
  summary: ResourceSummary;
  content: string | null;
  findings: Finding[];
};

const ignoredDirs = new Set([".git", "node_modules", "cache", ".cache"]);
const fileDirectivePattern =
  /^\s*(client_scripts?|server_scripts?|shared_scripts?|files?|ui_page|loadscreen)\b/;
const dependencyDirectivePattern = /^\s*dependenc(?:y|ies)\b/;

export async function scan(config: DoctorConfig): Promise<ScanResult> {
  const [status, serverCfgContent, resources, logs] = await Promise.all([
    fetchStatus(config),
    readOptional(config.serverCfg),
    listResources(config.resources),
    readRecentLogs(config.txdata),
  ]);

  const findings: Finding[] = [];
  if (!config.serverCfg && !config.resources && !config.txdata && !config.txadminUrl) {
    findings.push({
      id: "config.no_inputs",
      severity: "high",
      category: "status",
      title: "No FiveM paths or txAdmin status URL configured",
      evidence: ["Pass --server-cfg, --resources, --txdata, or --txadmin-url."],
      affectedFiles: [],
      suggestedFixes: [],
    });
  }

  if (config.serverCfg && serverCfgContent === null) {
    findings.push({
      id: "server_cfg.not_found",
      severity: "high",
      category: "server_cfg",
      title: "server.cfg was not found",
      evidence: [`Configured path: ${config.serverCfg}`],
      affectedFiles: [config.serverCfg],
      suggestedFixes: [],
    });
  }

  if (config.resources && !(await dirExists(config.resources))) {
    findings.push({
      id: "resources_root.not_found",
      severity: "high",
      category: "resource",
      title: "Resources root was not found",
      evidence: [`Configured path: ${config.resources}`],
      affectedFiles: [config.resources],
      suggestedFixes: [],
    });
  }

  const ensureEntries = serverCfgContent ? parseEnsures(serverCfgContent) : [];
  findings.push(...findMissingEnsuredResources(config, ensureEntries, resources));

  const manifestResults = await Promise.all(
    resources.map((resource) => inspectResource(config, resource.name)),
  );
  for (const result of manifestResults) {
    findings.push(...result.findings);
  }
  findings.push(...findLogIssues(logs));

  return {
    config: {
      txdata: config.txdata,
      serverCfg: config.serverCfg,
      resources: config.resources,
      txadminUrl: config.txadminUrl,
      allowWrite: config.allowWrite,
    },
    status: redactJson(status),
    resources,
    findings: sortFindings(findings),
  };
}

export async function inspectResource(
  config: DoctorConfig,
  resourceName: string,
): Promise<ManifestInspection> {
  const resources = await listResources(config.resources);
  const summary = resources.find((item) => item.name === resourceName);
  if (!summary) {
    return {
      summary: {
        name: resourceName,
        path: config.resources ? path.join(config.resources, resourceName) : resourceName,
        manifestPath: null,
        manifestKind: null,
      },
      content: null,
      findings: [
        {
          id: `resource.${resourceName}.not_found`,
          severity: "high",
          category: "resource",
          title: `Resource "${resourceName}" was not found`,
          evidence: [`No folder named "${resourceName}" was found under the resources root.`],
          affectedFiles: [],
          suggestedFixes: [],
        },
      ],
    };
  }

  if (!summary.manifestPath) {
    const target = path.join(summary.path, "fxmanifest.lua");
    const fix = createManifestFix(target, summary.name);
    return {
      summary,
      content: null,
      findings: [
        {
          id: `resource.${summary.name}.missing_manifest`,
          severity: "high",
          category: "manifest",
          title: `Resource "${summary.name}" has no manifest`,
          evidence: ["Expected fxmanifest.lua or __resource.lua in the resource folder."],
          affectedFiles: [summary.path],
          suggestedFixes: [fix],
        },
      ],
    };
  }

  const content = await fs.promises.readFile(summary.manifestPath, "utf8");
  return {
    summary,
    content: redact(content),
    findings: inspectManifest(summary, content, await listResourceNames(config.resources)),
  };
}

export async function proposeFixes(config: DoctorConfig): Promise<FixCandidate[]> {
  const result = await scan(config);
  return result.findings.flatMap((finding) => finding.suggestedFixes);
}

export async function applyFix(
  config: DoctorConfig,
  fixId: string,
  expectedHash?: string,
): Promise<{ applied: boolean; message: string; backupPath?: string; file?: string }> {
  if (!config.allowWrite) {
    return {
      applied: false,
      message: "Writes are disabled. Set FIVEM_DOCTOR_ALLOW_WRITE=1 to enable apply_fix.",
    };
  }

  const fix = (await proposeFixes(config)).find((candidate) => candidate.id === fixId);
  if (!fix) {
    return { applied: false, message: `Fix not found: ${fixId}` };
  }
  if (fix.risk !== "low") {
    return { applied: false, message: `Refusing non-low-risk fix: ${fixId}` };
  }
  if (!isUnderRoots(fix.file, rootsFor(config))) {
    return { applied: false, message: "Refusing to write outside configured txData/server/resources roots." };
  }
  if (expectedHash && expectedHash !== fix.beforeHash) {
    return { applied: false, message: "Expected hash does not match current fix hash." };
  }

  const currentContent = (await fileExists(fix.file))
    ? await fs.promises.readFile(fix.file, "utf8")
    : null;
  const currentHash = currentContent === null ? null : sha256(currentContent);
  if (currentHash !== fix.beforeHash) {
    return { applied: false, message: "File changed since the fix was generated." };
  }

  const backupPath = currentContent === null ? undefined : await backupFile(fix.file, currentContent);
  if (fix.operation.type === "create_file") {
    await fs.promises.mkdir(path.dirname(fix.file), { recursive: true });
    await fs.promises.writeFile(fix.file, fix.operation.content, { flag: "wx" });
  } else {
    await fs.promises.writeFile(fix.file, fix.operation.content);
  }

  return {
    applied: true,
    message: `Applied ${fixId}`,
    backupPath,
    file: fix.file,
  };
}

async function fetchStatus(config: DoctorConfig): Promise<unknown> {
  if (!config.txadminUrl) return null;
  const headers: Record<string, string> = {};
  if (config.txadminTokenEnv) {
    const token = process.env[config.txadminTokenEnv];
    if (!token) {
      return {
        error: "missing_txadmin_token_env",
        env: config.txadminTokenEnv,
      };
    }
    headers["x-txadmin-envtoken"] = token;
  }

  try {
    const response = await fetch(`${config.txadminUrl}/host/status`, { headers });
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { statusCode: response.status, body: redact(text.slice(0, 2_000)) };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function readOptional(filePath?: string): Promise<string | null> {
  if (!filePath || !(await fileExists(filePath))) return null;
  return fs.promises.readFile(filePath, "utf8");
}

function parseEnsures(serverCfg: string): EnsureEntry[] {
  return serverCfg
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\s*(ensure|start)\s+["']?([^"'\s#]+)["']?/i);
      if (!match) return null;
      return {
        command: match[1].toLowerCase() as "ensure" | "start",
        resource: match[2],
        line: index + 1,
      };
    })
    .filter((entry): entry is EnsureEntry => entry !== null);
}

async function listResources(resourcesRoot?: string): Promise<ResourceSummary[]> {
  if (!resourcesRoot || !(await dirExists(resourcesRoot))) return [];
  const dirs = await walkResourceDirs(resourcesRoot, 4);
  return Promise.all(
    dirs.map(async (dir) => {
      const fxmanifest = path.join(dir, "fxmanifest.lua");
      const oldManifest = path.join(dir, "__resource.lua");
      const hasFxmanifest = await fileExists(fxmanifest);
      const hasOldManifest = await fileExists(oldManifest);
      return {
        name: path.basename(dir),
        path: dir,
        manifestPath: hasFxmanifest ? fxmanifest : hasOldManifest ? oldManifest : null,
        manifestKind: hasFxmanifest ? "fxmanifest.lua" : hasOldManifest ? "__resource.lua" : null,
      };
    }),
  );
}

async function listResourceNames(resourcesRoot?: string): Promise<Set<string>> {
  const resources = await listResources(resourcesRoot);
  return new Set(resources.map((resource) => resource.name));
}

async function walkResourceDirs(root: string, maxDepth: number): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string, depth: number, insideResource: boolean): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const base = path.basename(dir);
    const isGroup = base.startsWith("[") && base.endsWith("]");
    const hasManifest = entries.some(
      (entry) => entry.isFile() && (entry.name === "fxmanifest.lua" || entry.name === "__resource.lua"),
    );
    const isResourceCandidate = depth > 0 && !isGroup && !insideResource;
    if (hasManifest || isResourceCandidate) {
      result.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) continue;
      await visit(path.join(dir, entry.name), depth + 1, insideResource || isResourceCandidate);
    }
  }
  await visit(root, 0, false);
  return result.filter((dir) => dir !== root);
}

function findMissingEnsuredResources(
  config: DoctorConfig,
  ensureEntries: EnsureEntry[],
  resources: ResourceSummary[],
): Finding[] {
  if (!config.serverCfg) return [];
  const known = new Set(resources.map((resource) => resource.name));
  return ensureEntries
    .filter((entry) => !known.has(entry.resource) && !entry.resource.startsWith("["))
    .map((entry) => ({
      id: `server_cfg.missing_resource.${entry.resource}`,
      severity: "high" as const,
      category: "server_cfg" as const,
      title: `server.cfg starts missing resource "${entry.resource}"`,
      evidence: [`${entry.command} ${entry.resource} on line ${entry.line}`],
      affectedFiles: [config.serverCfg as string],
      suggestedFixes: [],
    }));
}

function inspectManifest(
  summary: ResourceSummary,
  content: string,
  knownResources: Set<string>,
): Finding[] {
  const findings: Finding[] = [];
  const file = summary.manifestPath ?? summary.path;
  if (summary.manifestKind === "__resource.lua") {
    findings.push({
      id: `manifest.${summary.name}.legacy_manifest`,
      severity: "low",
      category: "manifest",
      title: `Resource "${summary.name}" uses legacy __resource.lua`,
      evidence: ["fxmanifest.lua is the current manifest format."],
      affectedFiles: [file],
      suggestedFixes: [],
    });
  }

  const hasFxVersion = /^\s*fx_version\s*[\("']/m.test(content);
  if (!hasFxVersion && summary.manifestKind === "fxmanifest.lua") {
    findings.push({
      id: `manifest.${summary.name}.missing_fx_version`,
      severity: "medium",
      category: "manifest",
      title: `Resource "${summary.name}" manifest is missing fx_version`,
      evidence: ["Expected a line like: fx_version 'cerulean'"],
      affectedFiles: [file],
      suggestedFixes: [prependManifestLineFix(file, content, "fx_version 'cerulean'")],
    });
  }

  const hasGame = /^\s*games?\s*[\({"']/m.test(content);
  if (!hasGame && summary.manifestKind === "fxmanifest.lua") {
    findings.push({
      id: `manifest.${summary.name}.missing_game`,
      severity: "medium",
      category: "manifest",
      title: `Resource "${summary.name}" manifest is missing game declaration`,
      evidence: ["Expected a line like: game 'gta5'"],
      affectedFiles: [file],
      suggestedFixes: [prependManifestLineFix(file, content, "game 'gta5'")],
    });
  }

  const refs = parseManifestRefs(content, fileDirectivePattern);
  for (const ref of refs) {
    if (ref.includes("*") || ref.includes("?") || ref.startsWith("@")) continue;
    const refPath = path.join(summary.path, ref);
    if (!fs.existsSync(refPath)) {
      findings.push({
        id: `manifest.${summary.name}.missing_file.${slug(ref)}`,
        severity: "medium",
        category: "manifest",
        title: `Resource "${summary.name}" references a missing file`,
        evidence: [`${ref} is listed in ${summary.manifestKind} but was not found.`],
        affectedFiles: [file, refPath],
        suggestedFixes: [],
      });
    }
  }

  const dependencies = parseManifestRefs(content, dependencyDirectivePattern);
  for (const dependency of dependencies) {
    if (!knownResources.has(dependency)) {
      findings.push({
        id: `manifest.${summary.name}.missing_dependency.${dependency}`,
        severity: "medium",
        category: "dependency",
        title: `Resource "${summary.name}" depends on missing resource "${dependency}"`,
        evidence: [`dependency '${dependency}' is declared but no matching resource folder was found.`],
        affectedFiles: [file],
        suggestedFixes: [],
      });
    }
  }

  return findings;
}

function parseManifestRefs(content: string, directivePattern: RegExp): string[] {
  const lines = content.split(/\r?\n/);
  const refs: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!directivePattern.test(line)) continue;
    let block = line;
    while (block.includes("{") && !block.includes("}") && i + 1 < lines.length) {
      i += 1;
      block += `\n${lines[i]}`;
    }
    for (const match of block.matchAll(/["']([^"']+)["']/g)) {
      refs.push(match[1]);
    }
  }
  return refs;
}

export async function readRecentLogs(txdata?: string): Promise<string[]> {
  if (!txdata || !(await dirExists(txdata))) return [];
  const files = await walkLogFiles(txdata, 5);
  const newest = (
    await Promise.all(
      files.map(async (file) => ({ file, stat: await fs.promises.stat(file) })),
    )
  )
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 6);

  return Promise.all(
    newest.map(async ({ file }) => {
      const stat = await fs.promises.stat(file);
      const handle = await fs.promises.open(file, "r");
      try {
        const length = Math.min(stat.size, 200_000);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
        return redact(buffer.toString("utf8"));
      } finally {
        await handle.close();
      }
    }),
  );
}

async function walkLogFiles(root: string, maxDepth: number): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !ignoredDirs.has(entry.name)) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile() && /\.log(\.\d+)?$/i.test(entry.name)) {
        result.push(entryPath);
      }
    }
  }
  await visit(root, 0);
  return result;
}

function findLogIssues(logs: string[]): Finding[] {
  const joined = logs.join("\n");
  const rules: Array<{
    id: string;
    severity: Severity;
    title: string;
    pattern: RegExp;
  }> = [
    {
      id: "logs.missing_license_key",
      severity: "critical",
      title: "FXServer log reports a missing license key",
      pattern: /no license key specified|sv_licenseKey/i,
    },
    {
      id: "logs.port_bind_failed",
      severity: "high",
      title: "FXServer log reports a port bind failure",
      pattern: /could not bind|address already in use|EADDRINUSE/i,
    },
    {
      id: "logs.resource_not_found",
      severity: "high",
      title: "Logs report a missing resource",
      pattern: /couldn'?t find resource|could not open resource metadata file/i,
    },
    {
      id: "logs.manifest_parse_error",
      severity: "high",
      title: "Logs report a malformed resource manifest",
      pattern: /could not parse resource metadata file|fxmanifest\.lua.*expected/i,
    },
    {
      id: "logs.missing_dependency",
      severity: "medium",
      title: "Logs report a missing dependency",
      pattern: /could not start dependency|missing dependency/i,
    },
    {
      id: "logs.database_connection",
      severity: "medium",
      title: "Logs suggest a database connection issue",
      pattern: /ECONNREFUSED|access denied for user|mysql|oxmysql|database/i,
    },
    {
      id: "logs.node_dependency",
      severity: "medium",
      title: "Logs suggest a Node/yarn/webpack dependency issue",
      pattern: /cannot find module|yarn|webpack|npm install/i,
    },
  ];

  return rules
    .filter((rule) => rule.pattern.test(joined))
    .map((rule) => ({
      id: rule.id,
      severity: rule.severity,
      category: "logs",
      title: rule.title,
      evidence: [firstMatchingLine(joined, rule.pattern)],
      affectedFiles: [],
      suggestedFixes: [],
    }));
}

function firstMatchingLine(text: string, pattern: RegExp): string {
  return redact(text.split(/\r?\n/).find((line) => pattern.test(line))?.trim() ?? "Pattern matched logs.");
}

function createManifestFix(file: string, resourceName: string): FixCandidate {
  const content = `fx_version 'cerulean'\ngame 'gta5'\n\nname '${resourceName}'\ndescription 'FiveM resource'\nversion '1.0.0'\n`;
  return {
    id: `create_manifest.${resourceName}`,
    file,
    beforeHash: null,
    operation: { type: "create_file", content },
    preview: `Create ${file} with a minimal FiveM fxmanifest.lua.`,
    risk: "low",
    reason: "A minimal manifest lets FXServer identify the resource. Script entries still need to be added by the server owner.",
  };
}

function prependManifestLineFix(file: string, content: string, line: string): FixCandidate {
  const nextContent = `${line}\n${content}`;
  return {
    id: `prepend_manifest_line.${slug(path.basename(path.dirname(file)))}.${slug(line)}`,
    file,
    beforeHash: sha256(content),
    operation: { type: "replace_file", content: nextContent },
    preview: `Insert "${line}" at the top of ${file}.`,
    risk: "low",
    reason: "FiveM fxmanifest.lua requires this declaration and adding it is non-destructive.",
  };
}

async function backupFile(file: string, content: string): Promise<string> {
  const backupDir = path.join(path.dirname(file), ".fivem-doctor-backups");
  await fs.promises.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${path.basename(file)}.${stamp}.bak`);
  await fs.promises.writeFile(backupPath, content, { flag: "wx" });
  return backupPath;
}

function sortFindings(findings: Finding[]): Finding[] {
  const rank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
