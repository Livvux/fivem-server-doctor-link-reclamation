#!/usr/bin/env node
import fs from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseArgs } from "./config.js";
import { redact } from "./redact.js";
import { applyFix, inspectResource, proposeFixes, readRecentLogs, scan } from "./scanner.js";
import type { DoctorConfig } from "./types.js";

const serverVersion = "0.1.0";

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function textResource(uri: URL, text: string, mimeType = "text/plain") {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType,
        text,
      },
    ],
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const server = new McpServer(
    {
      name: "fivem-server-doctor-mcp",
      version: serverVersion,
    },
    {
      instructions:
        "Diagnose local FiveM/txAdmin server files and logs. Never expose secrets. Only apply generated low-risk text fixes when FIVEM_DOCTOR_ALLOW_WRITE=1 is set.",
    },
  );

  registerTools(server, config);
  registerResources(server, config);
  registerPrompts(server);

  await server.connect(new StdioServerTransport());
}

function registerTools(server: McpServer, config: DoctorConfig): void {
  server.registerTool(
    "doctor_scan",
    {
      title: "Run FiveM Server Doctor Scan",
      description:
        "Scans txAdmin status/logs, server.cfg, resources, manifests, dependencies, and returns ranked findings.",
    },
    async () => jsonContent(await scan(config)),
  );

  server.registerTool(
    "resource_inspect",
    {
      title: "Inspect FiveM Resource",
      description: "Inspects one resource folder, manifest, dependencies, and related file evidence.",
      inputSchema: {
        name: z.string().min(1).describe("Resource folder name, for example oxmysql."),
      },
    },
    async ({ name }) => jsonContent(await inspectResource(config, name)),
  );

  server.registerTool(
    "propose_fixes",
    {
      title: "Propose Safe Text Fixes",
      description: "Returns exact low-risk fix candidates generated from the current scan.",
    },
    async () => jsonContent(await proposeFixes(config)),
  );

  server.registerTool(
    "apply_fix",
    {
      title: "Apply Generated Fix",
      description:
        "Applies one generated low-risk fix only when writes are enabled, the file hash still matches, and the target path is under a configured root.",
      inputSchema: {
        fixId: z.string().min(1),
        expectedHash: z.string().nullable().optional(),
      },
    },
    async ({ fixId, expectedHash }) =>
      jsonContent(await applyFix(config, fixId, expectedHash ?? undefined)),
  );
}

function registerResources(server: McpServer, config: DoctorConfig): void {
  server.registerResource(
    "status",
    "fivem://status",
    {
      title: "txAdmin Host Status",
      description: "Optional txAdmin /host/status response, redacted.",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = await scan(config);
      return textResource(uri, JSON.stringify(result.status, null, 2), "application/json");
    },
  );

  server.registerResource(
    "server-cfg",
    "fivem://server-cfg",
    {
      title: "FiveM server.cfg",
      description: "Configured server.cfg content with secrets masked.",
      mimeType: "text/plain",
    },
    async (uri) => {
      if (!config.serverCfg) return textResource(uri, "No --server-cfg path configured.");
      try {
        return textResource(uri, redact(await fs.promises.readFile(config.serverCfg, "utf8")));
      } catch (error) {
        return textResource(uri, error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerResource(
    "recent-logs",
    "fivem://logs/recent",
    {
      title: "Recent txAdmin/FiveM Logs",
      description: "Recent .log files below txData, newest first, with secrets masked.",
      mimeType: "text/plain",
    },
    async (uri) => textResource(uri, (await readRecentLogs(config.txdata)).join("\n\n--- log boundary ---\n\n")),
  );

  server.registerResource(
    "resources",
    "fivem://resources",
    {
      title: "FiveM Resources",
      description: "Discovered resource folders and manifest paths.",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = await scan(config);
      return textResource(uri, JSON.stringify(result.resources, null, 2), "application/json");
    },
  );

  server.registerResource(
    "resource-manifest",
    new ResourceTemplate("fivem://resources/{name}/manifest", {
      list: undefined,
      complete: {
        name: async (value) => {
          const result = await scan(config);
          return result.resources.map((resource) => resource.name).filter((name) => name.startsWith(value));
        },
      },
    }),
    {
      title: "FiveM Resource Manifest",
      description: "Redacted fxmanifest.lua or __resource.lua content for one resource.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const name = String(variables.name ?? "");
      const result = await inspectResource(config, name);
      return textResource(uri, result.content ?? `No manifest found for resource "${name}".`);
    },
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "diagnose_fivem_startup",
    {
      title: "Diagnose FiveM Startup",
      description: "Guide an assistant through a startup failure diagnosis using doctor_scan first.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Run doctor_scan. Prioritize critical/high findings, explain the evidence plainly, and only propose apply_fix when the fix candidate is low risk and directly tied to the failure.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_new_resource_install",
    {
      title: "Review New Resource Install",
      description: "Inspect a newly installed resource before server restart.",
      argsSchema: {
        resourceName: z.string().optional(),
      },
    },
    ({ resourceName }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: resourceName
              ? `Run resource_inspect for "${resourceName}", then check whether server.cfg ensures it and whether dependencies/files are present.`
              : "Run doctor_scan, identify newly suspicious resources, then inspect the relevant resource manifests and dependencies.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain_txadmin_log_error",
    {
      title: "Explain txAdmin Log Error",
      description: "Explain a txAdmin/FiveM log error and connect it to local evidence.",
      argsSchema: {
        error: z.string().min(1),
      },
    },
    ({ error }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Explain this FiveM/txAdmin error, then use doctor_scan or resource_inspect to confirm whether the local files support that diagnosis. Error: ${error}`,
          },
        },
      ],
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
