# pi-codebase-memory

A [pi](https://github.com/earendil-works/pi) package that bridges the **[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)** server into pi as native tools. Gives your agent a fast, local **tree-sitter knowledge graph** of your repos — structural code search, call-path tracing, architecture overviews, and change-impact analysis in milliseconds, with far fewer tokens than file-by-file grepping.

- **Server**: `codebase-memory-mcp` (single static binary, MCP over **stdio**, 100% local, zero dependencies)
- **Upstream**: [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)

## Requirements

The `codebase-memory-mcp` binary installed locally:

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
```

(macOS/Linux; Windows via `install.ps1`. Also on Homebrew, Scoop, AUR, npm, PyPI.) The binary is resolved from `CBM_MCP_BIN`, then `~/.local/bin/codebase-memory-mcp`, then your `PATH`.

## Install

```bash
pi install npm:pi-codebase-memory-mcp
```

Or try it without installing:

```bash
pi -e npm:pi-codebase-memory-mcp
```

## What you get

- **Extension** — spawns the local `codebase-memory-mcp` server over stdio, discovers its tools dynamically, and registers each as a pi tool with a `cbm_` prefix.
- **`cbm_connect` tool** — always available, so the agent can start (or restart) the server mid-session and pick up newly discovered tools immediately.
- **Safety gate** — `cbm_delete_project` pops a confirmation dialog before wiping a project's graph (disable with `CBM_CONFIRM=off`).
- **Clean tool rendering** — compact ✓/✗ rows with summaries instead of raw JSON; expand for full output.
- **Skill** — `codebase-memory`, teaching the agent the index → search → trace → query workflow.
- **Command** — `/cbm` shows status and registered tools; `/cbm reconnect` restarts and re-discovers.

## Tools (discovered dynamically)

Indexing: `cbm_index_repository`, `cbm_list_projects`, `cbm_delete_project`, `cbm_index_status`

Querying: `cbm_search_graph`, `cbm_trace_path`, `cbm_detect_changes`, `cbm_query_graph`, `cbm_get_graph_schema`, `cbm_get_code_snippet`, `cbm_get_architecture`, `cbm_search_code`, `cbm_manage_adr`, `cbm_ingest_traces`

## Example prompts

- "Index this project."
- "What calls `ProcessOrder`?"
- "Find every function matching `.*Handler.*`."
- "Give me an architecture overview of this repo."
- "What's the blast radius of my current git changes?"
- "Show the source for the `Search` function."

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `CBM_MCP_BIN` | (auto) | Absolute path to the `codebase-memory-mcp` binary (overrides auto-detection) |
| `CBM_CONFIRM` | `on` | Set to `off` to skip the confirmation dialog for `cbm_delete_project` |

## Notes

- Tools are discovered at connection time; the set may change between server versions.
- If the binary isn't installed when pi starts, pi still starts normally — install it, then run `/cbm reconnect` or ask the agent to connect.
- Index with an **absolute** `repo_path`. After the first index, a background watcher keeps the graph fresh.

## License

MIT
