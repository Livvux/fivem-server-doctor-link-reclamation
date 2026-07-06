# FiveM fxmanifest Doctor

`fxmanifest.lua` is the first place to check when a FiveM resource is present but still fails to start. A manifest can be syntactically valid Lua-like text and still be operationally wrong because it omits required declarations or lists files that are not on disk.

`fivem-server-doctor-mcp` parses manifests conservatively as text. It never executes Lua.

## Checks In v1

- Missing `fx_version`.
- Missing `game` or `games` declaration.
- Legacy `__resource.lua` warning.
- Missing files referenced by:
  - `client_script` / `client_scripts`
  - `server_script` / `server_scripts`
  - `shared_script` / `shared_scripts`
  - `file` / `files`
  - `ui_page`
  - `loadscreen`
- Missing dependencies declared by `dependency` or `dependencies`.

## Example Finding

```json
{
  "id": "manifest.myresource.missing_file.server_lua",
  "severity": "medium",
  "category": "manifest",
  "title": "Resource \"myresource\" references a missing file",
  "evidence": ["server.lua is listed in fxmanifest.lua but was not found."],
  "affectedFiles": ["/server/resources/myresource/fxmanifest.lua", "/server/resources/myresource/server.lua"],
  "suggestedFixes": []
}
```

## Fix Candidates

For low-risk manifest edits, the MCP server can generate exact fix candidates:

- Create a minimal `fxmanifest.lua` when a resource folder has no manifest.
- Prepend a missing `fx_version 'cerulean'`.
- Prepend a missing `game 'gta5'`.

`apply_fix` verifies the current file hash before writing. If the file changed after the fix was generated, the write is rejected.
