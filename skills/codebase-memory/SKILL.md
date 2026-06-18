---
name: codebase-memory
description: Query a tree-sitter knowledge graph of a codebase via the codebase-memory-mcp server (cbm_* tools). Use when the user asks to index a repo, find functions/classes, trace who calls what, get an architecture overview, assess change impact/blast radius, find dead code, or run structural code queries instead of grepping file-by-file.
---

# codebase-memory (knowledge graph)

This skill uses the `cbm_*` tools (provided by the `pi-codebase-memory` extension), backed by the local **codebase-memory-mcp** server — a single static binary that builds a tree-sitter knowledge graph of repositories and answers structural queries in milliseconds. All processing is 100% local.

## Connection workflow

1. If `cbm_*` tools are already registered, use them directly.
2. If only `cbm_connect` is available (or calls fail to start), call `cbm_connect` first. It spawns the binary over stdio and registers the tool set.
3. If `cbm_connect` fails, tell the user to install the server, then retry (or run `/cbm reconnect`):
   ```
   curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
   ```
   The binary is resolved from `CBM_MCP_BIN`, then `~/.local/bin/codebase-memory-mcp`, then `PATH`.

## Working guidelines

- **Index first.** Before querying a repo, run `cbm_index_repository` with an **absolute** `repo_path`. Use `cbm_list_projects` / `cbm_index_status` to check what's already indexed. Indexing keeps itself fresh via a background watcher after the first pass.
- **Discover names before tracing.** `cbm_trace_path` / `cbm_get_code_snippet` need exact names. Use `cbm_search_graph` (regex `name_pattern`, `label` filters) to find the precise symbol first. `cbm_get_code_snippet` uses qualified names: `<project>.<path_parts>.<name>`.
- **Run schema first for graph queries.** Before `cbm_query_graph` (Cypher read subset), call `cbm_get_graph_schema` to see node labels, edge types, and properties.
- **Prefer the graph over grep.** For "what calls X", "what does X depend on", architecture, or impact analysis, one `cbm_*` query replaces dozens of read/grep cycles — far fewer tokens.
- **Tools are dynamic.** The exact tool set is discovered at connection time and may change between server versions; follow each tool's own description and schema.

## Common tasks

- **Index:** `cbm_index_repository({ repo_path: "/abs/path" })`
- **Find symbols:** `cbm_search_graph({ name_pattern: ".*Handler.*", label: "Function" })`
- **Who calls / what it calls:** `cbm_trace_path({ function_name: "ProcessOrder", direction: "inbound" })` (or `outbound` / `both`, depth 1–5)
- **Change impact:** `cbm_detect_changes(...)` — maps git diff to affected symbols + blast radius
- **Overview:** `cbm_get_architecture(...)` — languages, packages, routes, hotspots, clusters
- **Read source:** `cbm_get_code_snippet({ qualified_name: "<project>.<path>.<name>" })`
- **Cypher:** `cbm_get_graph_schema()` then `cbm_query_graph({ ... })`

## Status / recovery

- `/cbm` — show binary path, connection state, registered tools.
- `/cbm reconnect` — restart the server and re-discover tools.
- `cbm_delete_project` triggers a confirmation dialog (disable with `CBM_CONFIRM=off`). If declined, don't retry — ask the user.
