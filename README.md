# FiveM Server Doctor MCP

Local MCP server for Claude Desktop, Codex, and other MCP clients that answers one question:

> Why is my FiveM server or resource broken?

`fivem-server-doctor-mcp` reads local txAdmin/FiveM files over stdio, scans `server.cfg`, resource folders, manifests, and recent logs, then returns ranked findings with exact evidence. It can propose narrow text-file fixes and can apply only generated low-risk fixes when writes are explicitly enabled.

Maintained by FiveMX. Sponsor link: [fivemx.com](https://fivemx.com).

## What It Detects

- Missing resource folders referenced by `ensure` or `start`.
- Resource folders missing `fxmanifest.lua` or `__resource.lua`.
- Common `fxmanifest.lua` problems: missing `fx_version`, missing `game`, missing listed files, missing dependencies.
- txAdmin/FiveM log patterns: missing resources, malformed manifests, missing dependency hints, port bind failures, missing license keys, database connection hints, yarn/webpack/module install errors.
- Secrets in output are masked, including license keys, DB URLs/passwords, tokens, and connection strings.

The scanner parses manifests as text. It never executes Lua from a resource.

## Install

```bash
pnpm add -g fivem-server-doctor-mcp
```

Or run it without a global install:

```bash
npx -y fivem-server-doctor-mcp --server-cfg /path/to/server.cfg --resources /path/to/resources
```

## CLI Options

```bash
fivem-server-doctor-mcp \
  --txdata /path/to/txData/default \
  --server-cfg /path/to/server.cfg \
  --resources /path/to/resources
```

Optional txAdmin status check:

```bash
TXHOST_API_TOKEN=... fivem-server-doctor-mcp \
  --txadmin-url http://127.0.0.1:40120 \
  --txadmin-token-env TXHOST_API_TOKEN
```

Writes are disabled by default. Enable generated low-risk patch application only for the launched process:

```bash
FIVEM_DOCTOR_ALLOW_WRITE=1 fivem-server-doctor-mcp --server-cfg ./server.cfg --resources ./resources
```

## Codex Setup

```bash
codex mcp add fivem-doctor -- npx -y fivem-server-doctor-mcp \
  --server-cfg /path/to/server.cfg \
  --resources /path/to/resources \
  --txdata /path/to/txData/default
```

Then ask Codex:

```text
Use fivem-doctor to run doctor_scan and explain why my FiveM server is not starting.
```

## Claude Desktop Setup

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "fivem-doctor": {
      "command": "npx",
      "args": [
        "-y",
        "fivem-server-doctor-mcp",
        "--server-cfg",
        "/path/to/server.cfg",
        "--resources",
        "/path/to/resources",
        "--txdata",
        "/path/to/txData/default"
      ]
    }
  }
}
```

For write-enabled local patching, add an env block:

```json
{
  "mcpServers": {
    "fivem-doctor": {
      "command": "npx",
      "args": ["-y", "fivem-server-doctor-mcp", "--server-cfg", "/path/to/server.cfg", "--resources", "/path/to/resources"],
      "env": {
        "FIVEM_DOCTOR_ALLOW_WRITE": "1"
      }
    }
  }
}
```

## MCP Interface

Tools:

- `doctor_scan`: scans configured status, logs, `server.cfg`, resources, and manifests.
- `resource_inspect`: inspects one resource folder and manifest.
- `propose_fixes`: returns generated fix candidates.
- `apply_fix`: applies one generated fix only when writes are enabled, the target hash matches, the path is under configured roots, and the fix risk is low.

Resources:

- `fivem://status`
- `fivem://server-cfg`
- `fivem://logs/recent`
- `fivem://resources`
- `fivem://resources/{name}/manifest`

Prompts:

- `diagnose_fivem_startup`
- `review_new_resource_install`
- `explain_txadmin_log_error`

## Safety Model

- No private txAdmin UI scraping.
- No browser sessions, cookies, or CSRF-protected routes.
- No RCON, restart, stop, ban, or live server control tools in v1.
- No arbitrary file writes.
- `apply_fix` only writes generated low-risk changes for `server.cfg`, `fxmanifest.lua`, or `__resource.lua` style text fixes under configured roots.
- Existing files are backed up into `.fivem-doctor-backups/` before replacement.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The test suite uses fixture-based `node:test` coverage and starts a real stdio MCP client against the built server.

## Docs

- [Fix FiveM resource not starting with Claude or Codex](docs/fix-fivem-resource-not-starting-with-claude-codex.md)
- [FiveM fxmanifest doctor](docs/fivem-fxmanifest-doctor.md)
- [txAdmin log analyzer MCP](docs/txadmin-log-analyzer-mcp.md)

## License

MIT
