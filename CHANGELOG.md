# Changelog

## [0.1.3] - 2026-06-19

### Fixed

- Stop inheriting the codebase-memory-mcp child process's stderr into Pi's TUI (set `stderr: "ignore"` on `StdioClientTransport`); default `CBM_LOG_LEVEL=error` for the child when the user hasn't set one. Fixes #2.

## [0.1.2] - 2026-06-18

### Changed

- Simplified extension (dropped cosmetic label/details); README refreshed to match.

## [0.1.1] - 2026-06-18

### Changed

- Renamed npm package to `pi-codebase-memory-mcp` (`pi-codebase-memory` was taken).

## [0.1.0] - 2026-06-18

### Added

- Initial release: bridges the codebase-memory-mcp stdio server into pi.
- Dynamic discovery of MCP tools registered with a `cbm_` prefix.
- `cbm_connect` tool and `/cbm` (+ `/cbm reconnect`) command.
- Confirmation gate for `cbm_delete_project` (disable with `CBM_CONFIRM=off`).
- `codebase-memory` skill: index → search → trace → query workflow.
