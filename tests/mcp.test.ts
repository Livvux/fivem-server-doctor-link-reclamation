import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fivem-doctor-mcp-"));
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test("MCP server lists tools/resources/prompts and runs doctor_scan over stdio", async () => {
  const resources = path.join(tempDir, "resources");
  const txdata = path.join(tempDir, "txData");
  await fs.promises.mkdir(path.join(resources, "broken"), { recursive: true });
  await fs.promises.mkdir(path.join(txdata, "logs"), { recursive: true });
  const serverCfg = path.join(tempDir, "server.cfg");
  await fs.promises.writeFile(serverCfg, "ensure broken\nensure absent_resource\n");
  await fs.promises.writeFile(path.join(txdata, "logs", "latest.log"), "Couldn't find resource absent_resource.\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist/src/index.js"),
      "--server-cfg",
      serverCfg,
      "--resources",
      resources,
      "--txdata",
      txdata,
    ],
    stderr: "pipe",
  });
  const client = new Client({ name: "fivem-doctor-test", version: "0.0.0" });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("doctor_scan"), true);
    assert.equal(toolNames.includes("resource_inspect"), true);
    assert.equal(toolNames.includes("propose_fixes"), true);
    assert.equal(toolNames.includes("apply_fix"), true);

    const prompts = await client.listPrompts();
    assert.equal(prompts.prompts.some((prompt) => prompt.name === "diagnose_fivem_startup"), true);

    const resourcesList = await client.listResources();
    assert.equal(resourcesList.resources.some((resource) => resource.uri === "fivem://server-cfg"), true);

    const scan = await client.callTool({ name: "doctor_scan", arguments: {} });
    const text = extractText(scan);
    const parsed = JSON.parse(text) as { findings: Array<{ id: string }> };
    assert.equal(parsed.findings.some((finding) => finding.id === "server_cfg.missing_resource.absent_resource"), true);

    const disabledApply = await client.callTool({
      name: "apply_fix",
      arguments: { fixId: "does-not-matter" },
    });
    const disabledText = extractText(disabledApply);
    assert.match(disabledText, /Writes are disabled/);
  } finally {
    await client.close();
  }
});

function extractText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .join("\n");
}
