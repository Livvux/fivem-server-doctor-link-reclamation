# Fix FiveM Resource Not Starting With Claude Or Codex

FiveM resource startup failures usually come from a small set of local problems: the resource folder is not where `server.cfg` says it is, the manifest is missing, a dependency is absent, or the manifest references files that were not copied.

`fivem-server-doctor-mcp` lets Claude Desktop or Codex inspect those files locally through MCP without giving the assistant browser cookies, txAdmin UI access, or server-control permissions.

## Run A Startup Scan

```bash
codex mcp add fivem-doctor -- npx -y fivem-server-doctor-mcp \
  --server-cfg /path/to/server.cfg \
  --resources /path/to/resources \
  --txdata /path/to/txData/default
```

Then ask:

```text
Use fivem-doctor to run doctor_scan. Tell me why this FiveM resource is not starting and cite the exact file or log evidence.
```

The scan checks:

- `ensure` and `start` entries in `server.cfg`.
- Resource folder names below the configured resources root.
- `fxmanifest.lua` and `__resource.lua` presence.
- Manifest declarations and referenced files.
- Recent txAdmin/FiveM logs.

## Safe Fix Flow

The recommended workflow is read-only first:

1. Run `doctor_scan`.
2. Run `resource_inspect` for the failing resource.
3. Run `propose_fixes`.
4. Review the fix preview.
5. Restart the MCP server with `FIVEM_DOCTOR_ALLOW_WRITE=1` only if the generated fix is exactly what you want.
6. Run `apply_fix` with the selected fix id.

The MCP server creates a backup before replacing an existing manifest.

## What It Does Not Do

It does not restart FXServer, run RCON, scrape private txAdmin pages, or install missing dependencies automatically. Those actions are intentionally out of scope for v1.
