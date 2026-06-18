/**
 * codebase-memory-mcp Extension
 *
 * Bridges the local codebase-memory-mcp server into pi. The server is a single
 * static binary that speaks MCP over stdio; pi spawns it and registers its
 * tools dynamically (cbm_* prefix). It builds a tree-sitter knowledge graph of
 * your repos and answers structural queries (search, trace, architecture,
 * impact analysis) in milliseconds — all 100% local.
 *
 * Binary resolution (first that exists):
 *   1. CBM_MCP_BIN env var (absolute path)
 *   2. ~/.local/bin/codebase-memory-mcp  (default install location)
 *   3. "codebase-memory-mcp" on PATH
 *
 * Install the server: https://github.com/DeusData/codebase-memory-mcp
 *   curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { Type } from "typebox";

const VERSION = "0.1.0";
const TOOL_PREFIX = "cbm_";
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 300_000; // indexing a big repo can take minutes
const CONFIRM_DESTRUCTIVE = (process.env.CBM_CONFIRM ?? "on") !== "off";

function resolveBinary(): string {
	if (process.env.CBM_MCP_BIN) return process.env.CBM_MCP_BIN;
	const local = join(homedir(), ".local", "bin", "codebase-memory-mcp");
	if (existsSync(local)) return local;
	return "codebase-memory-mcp"; // fall back to PATH
}

const BIN = resolveBinary();

const NOT_INSTALLED_HINT =
	"Could not start the codebase-memory-mcp server. Install it, then call cbm_connect again:\n" +
	"  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash\n" +
	`Resolved binary: ${BIN} (override with CBM_MCP_BIN).`;

interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

type PiContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function sanitizeToolName(name: string): string {
	const base = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
	return base.startsWith(TOOL_PREFIX) ? base : `${TOOL_PREFIX}${base}`;
}

function toPiContent(result: { content?: unknown }): PiContentBlock[] {
	const blocks = Array.isArray(result.content) ? result.content : [];
	const out: PiContentBlock[] = [];
	for (const block of blocks as Array<Record<string, unknown>>) {
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") {
			out.push({ type: "text", text: block.text });
		} else if (block.type === "image" && typeof block.data === "string") {
			out.push({ type: "image", data: block.data, mimeType: (block.mimeType as string) ?? "image/png" });
		} else {
			out.push({ type: "text", text: JSON.stringify(block) });
		}
	}
	if (out.length === 0) out.push({ type: "text", text: "(empty result)" });
	return out;
}

function textOf(blocks: PiContentBlock[]): string {
	return blocks
		.filter((b): b is Extract<PiContentBlock, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("\n\n");
}

function firstLine(text: string, max = 100): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

export default function codebaseMemoryExtension(pi: ExtensionAPI) {
	let client: Client | undefined;
	let connecting: Promise<Client> | undefined;
	const registeredNames = new Set<string>();

	// ---------------------------------------------------------------- connection

	async function connect(): Promise<Client> {
		const next = new Client({ name: "pi-codebase-memory", version: VERSION });
		const transport = new StdioClientTransport({
			command: BIN,
			args: [],
			env: process.env as Record<string, string>,
		});
		await withTimeout(next.connect(transport), CONNECT_TIMEOUT_MS, "codebase-memory-mcp start");
		return next;
	}

	async function getClient(forceReconnect = false): Promise<Client> {
		if (forceReconnect && client) {
			await client.close().catch(() => {});
			client = undefined;
		}
		if (client) return client;
		if (!connecting) {
			connecting = connect()
				.then((c) => {
					client = c;
					return c;
				})
				.finally(() => {
					connecting = undefined;
				});
		}
		return connecting;
	}

	async function callTool(name: string, args: Record<string, unknown>): Promise<PiContentBlock[]> {
		let c: Client;
		try {
			c = await getClient();
		} catch {
			throw new Error(NOT_INSTALLED_HINT);
		}
		let result: { content?: unknown; isError?: boolean };
		try {
			result = (await withTimeout(
				c.callTool({ name, arguments: args }),
				CALL_TIMEOUT_MS,
				`codebase-memory tool "${name}"`,
			)) as typeof result;
		} catch {
			// Process may have died. Respawn once and retry.
			try {
				c = await getClient(true);
			} catch {
				throw new Error(NOT_INSTALLED_HINT);
			}
			result = (await withTimeout(
				c.callTool({ name, arguments: args }),
				CALL_TIMEOUT_MS,
				`codebase-memory tool "${name}"`,
			)) as typeof result;
		}
		const blocks = toPiContent(result);
		if (result.isError) {
			throw new Error(textOf(blocks) || "codebase-memory tool call failed");
		}
		return blocks;
	}

	// ---------------------------------------------------------------- rendering

	function makeRenderers(piName: string) {
		return {
			renderCall(args: Record<string, unknown>, theme: any) {
				let content = theme.fg("toolTitle", theme.bold(piName));
				const summary = firstLine(JSON.stringify(args ?? {}), 80);
				if (summary && summary !== "{}") content += " " + theme.fg("muted", summary);
				return new Text(content, 0, 0);
			},
			renderResult(result: any, opts: { expanded: boolean; isPartial: boolean }, theme: any) {
				if (opts.isPartial) {
					return new Text(theme.fg("warning", "⟳ Querying graph…"), 0, 0);
				}
				const blocks = (result?.content ?? []) as PiContentBlock[];
				const text = textOf(blocks);
				if (result?.isError) {
					return new Text(theme.fg("error", `✗ ${opts.expanded ? text : firstLine(text)}`), 0, 0);
				}
				if (opts.expanded) {
					const body = text.length > 4000 ? `${text.slice(0, 4000)}\n…(truncated)` : text;
					return new Text(theme.fg("success", "✓ ") + theme.fg("dim", body), 0, 0);
				}
				return new Text(theme.fg("success", "✓ ") + theme.fg("dim", firstLine(text)), 0, 0);
			},
		};
	}

	// ---------------------------------------------------------------- dynamic tools

	function registerMcpTool(tool: McpToolInfo) {
		const piName = sanitizeToolName(tool.name);
		if (registeredNames.has(piName)) return;
		registeredNames.add(piName);

		const parameters =
			tool.inputSchema && typeof tool.inputSchema === "object"
				? (tool.inputSchema as unknown as TSchema)
				: Type.Object({});

		pi.registerTool({
			name: piName,
			label: `cbm: ${tool.name}`,
			description:
				tool.description ?? `codebase-memory-mcp tool "${tool.name}". Queries the local knowledge graph.`,
			parameters,
			...makeRenderers(piName),
			async execute(_toolCallId, params) {
				const blocks = await callTool(tool.name, (params ?? {}) as Record<string, unknown>);
				return { content: blocks, details: { binary: BIN, mcpTool: tool.name } };
			},
		});
	}

	async function discoverAndRegister(): Promise<string[]> {
		const c = await getClient();
		const { tools } = await withTimeout(c.listTools(), CONNECT_TIMEOUT_MS, "codebase-memory tools/list");
		for (const tool of tools as McpToolInfo[]) registerMcpTool(tool);
		return (tools as McpToolInfo[]).map((t) => sanitizeToolName(t.name));
	}

	// ---------------------------------------------------------------- cbm_connect

	pi.registerTool({
		name: "cbm_connect",
		label: "cbm: connect",
		description:
			"Start (or restart) the local codebase-memory-mcp server and discover its tools. Use this when cbm_* " +
			"tools are missing or failing. Requires the codebase-memory-mcp binary to be installed " +
			"(https://github.com/DeusData/codebase-memory-mcp).",
		promptSnippet: "Start the codebase-memory knowledge-graph server and discover its tools",
		promptGuidelines: [
			"Use cbm_connect first when the user asks to index a repo or query code structure and no cbm_* tools are available, or when cbm_* calls fail to start.",
		],
		parameters: Type.Object({}),
		async execute() {
			try {
				await getClient(true);
				const names = await discoverAndRegister();
				return {
					content: [
						{
							type: "text",
							text: `Started codebase-memory-mcp (${BIN}).\nAvailable tools (${names.length}): ${names.join(", ") || "none"}`,
						},
					],
					details: { binary: BIN },
				};
			} catch {
				throw new Error(NOT_INSTALLED_HINT);
			}
		},
	});

	// ---------------------------------------------------------------- confirmation gate

	if (CONFIRM_DESTRUCTIVE) {
		pi.on("tool_call", async (event: any, ctx: any) => {
			if (event.toolName !== "cbm_delete_project" || !ctx.hasUI) return;
			const ok = await ctx.ui.confirm(
				"codebase-memory: delete project",
				`This removes a project and all its graph data.\nProceed?\n\n(Disable this check with CBM_CONFIRM=off)`,
			);
			if (!ok) {
				return { block: true, reason: "Blocked by user: project deletion was not approved." };
			}
		});
	}

	// ---------------------------------------------------------------- startup + command

	// Try to start + discover at load so tools are available from the first turn.
	// Non-fatal and silent if the binary isn't installed — installing the package
	// never nags. Guidance surfaces on demand via cbm_connect or /cbm.
	void discoverAndRegister().catch(() => undefined);

	pi.registerCommand("cbm", {
		description: "codebase-memory status. Usage: /cbm [reconnect]",
		handler: async (args, ctx) => {
			if (args.trim() === "reconnect") {
				try {
					await getClient(true);
					const names = await discoverAndRegister();
					ctx.ui.notify(`codebase-memory connected (${names.length} tools): ${names.join(", ")}`, "info");
				} catch (error) {
					ctx.ui.notify(
						`Reconnect failed: ${error instanceof Error ? error.message : String(error)}\n${NOT_INSTALLED_HINT}`,
						"error",
					);
				}
				return;
			}
			const lines = [
				`Binary: ${BIN}`,
				`Connected: ${client ? "yes" : "no"}`,
				`Delete confirmation: ${CONFIRM_DESTRUCTIVE ? "on" : "off (CBM_CONFIRM=off)"}`,
				`Tools (${registeredNames.size + 1}): cbm_connect, ${[...registeredNames].join(", ") || "(none discovered)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
