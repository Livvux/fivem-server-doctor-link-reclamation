# txAdmin Log Analyzer MCP

txAdmin is useful for server status and logs, but assistants should not need private UI scraping or browser sessions to diagnose common FiveM startup failures. `fivem-server-doctor-mcp` reads local txData log files and optionally calls txAdmin `/host/status` when you provide a local URL and token environment variable.

## Configure Logs

```bash
npx -y fivem-server-doctor-mcp \
  --txdata /path/to/txData/default \
  --server-cfg /path/to/server.cfg \
  --resources /path/to/resources
```

The MCP resource `fivem://logs/recent` exposes recent `.log` files with secrets masked.

## Log Patterns In v1

- Missing license key.
- Port bind failure or address already in use.
- Missing resource.
- Malformed resource manifest.
- Missing dependency.
- Database connection hints for MySQL/oxmysql-style failures.
- Node/yarn/webpack/module install errors.

## Optional txAdmin Status

```bash
TXHOST_API_TOKEN=... npx -y fivem-server-doctor-mcp \
  --txadmin-url http://127.0.0.1:40120 \
  --txadmin-token-env TXHOST_API_TOKEN
```

The token value is read from the environment and masked from output. The MCP server does not access private txAdmin UI routes, cookies, browser sessions, or CSRF-protected APIs.
