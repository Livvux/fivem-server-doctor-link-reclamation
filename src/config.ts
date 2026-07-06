import path from "node:path";
import type { DoctorConfig } from "./types.js";

const flagsWithValues = new Set([
  "--txdata",
  "--server-cfg",
  "--resources",
  "--txadmin-url",
  "--txadmin-token-env",
]);

export function parseArgs(argv: string[]): DoctorConfig {
  const config: DoctorConfig = {
    allowWrite: process.env.FIVEM_DOCTOR_ALLOW_WRITE === "1",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    if (!flagsWithValues.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    i += 1;

    if (arg === "--txdata") config.txdata = resolvePath(value);
    if (arg === "--server-cfg") config.serverCfg = resolvePath(value);
    if (arg === "--resources") config.resources = resolvePath(value);
    if (arg === "--txadmin-url") config.txadminUrl = value.replace(/\/+$/, "");
    if (arg === "--txadmin-token-env") config.txadminTokenEnv = value;
  }

  return config;
}

function resolvePath(value: string): string {
  return path.resolve(process.cwd(), value);
}

function printHelpAndExit(): never {
  process.stdout.write(`FiveM Server Doctor MCP

Usage:
  fivem-server-doctor-mcp --server-cfg ./server.cfg --resources ./resources
  fivem-server-doctor-mcp --txdata ./txData/default --server-cfg ./server.cfg --resources ./resources

Options:
  --txdata <path>             txAdmin txData profile or root path
  --server-cfg <path>         FiveM server.cfg path
  --resources <path>          FiveM resources root path
  --txadmin-url <url>         Optional txAdmin URL for /host/status
  --txadmin-token-env <name>  Env var that contains TXHOST_API_TOKEN

Writes are disabled unless FIVEM_DOCTOR_ALLOW_WRITE=1 is set.
`);
  process.exit(0);
}
