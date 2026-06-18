/**
 * codebase-memory-mcp Extension (minimal)
 *
 * Spawns the local codebase-memory-mcp binary over stdio and registers its
 * tools dynamically (cbm_* prefix). Binary: CBM_MCP_BIN, else
 * ~/.local/bin/codebase-memory-mcp, else PATH.
 * Install: https://github.com/DeusData/codebase-memory-mcp
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { TSchema } from "typebox";
import { Type } from "typebox";

const BIN =
	process.env.CBM_MCP_BIN ||
	(existsSync(join(homedir(), ".local/bin/codebase-memory-mcp"))
		? join(homedir(), ".local/bin/codebase-memory-mcp")
		: "codebase-memory-mcp");

const HINT =
	`Could not start codebase-memory-mcp (${BIN}). Install it, then call cbm_connect:\n` +
	"  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash";

export default function codebaseMemoryExtension(pi: ExtensionAPI) {
	let client: Client | undefined;
	const seen = new Set<string>();

	async function getClient(reconnect = false): Promise<Client> {
		if (reconnect && client) {
			await client.close().catch(() => {});
			client = undefined;
		}
		if (client) return client;
		const c = new Client({ name: "pi-codebase-memory", version: "0.1.1" });
		await c.connect(new StdioClientTransport({ command: BIN, args: [], env: process.env as Record<string, string> }));
		client = c;
		return c;
	}

	async function register(): Promise<string[]> {
		const c = await getClient();
		const { tools } = await c.listTools();
		for (const t of tools) {
			const name = t.name.startsWith("cbm_") ? t.name : `cbm_${t.name}`;
			if (seen.has(name)) continue;
			seen.add(name);
			pi.registerTool({
				name,
				description: t.description ?? `codebase-memory-mcp tool "${t.name}".`,
				parameters: (t.inputSchema as unknown as TSchema) ?? Type.Object({}),
				async execute(_id, params) {
					const args = (params ?? {}) as Record<string, unknown>;
					// ponytail: respawn-and-retry once if the process died; SDK handles the call timeout
					let res: { content?: any[]; isError?: boolean };
					try {
						res = (await (await getClient()).callTool({ name: t.name, arguments: args })) as any;
					} catch {
						res = (await (await getClient(true)).callTool({ name: t.name, arguments: args })) as any;
					}
					if (res.isError) throw new Error((res.content ?? []).map((b) => b.text).join("\n") || "tool call failed");
					return { content: res.content ?? [{ type: "text", text: "(empty)" }] };
				},
			});
		}
		return [...seen];
	}

	pi.registerTool({
		name: "cbm_connect",
		label: "cbm: connect",
		description:
			"Start (or restart) the local codebase-memory-mcp server and discover its tools. Use when cbm_* tools are missing or failing.",
		promptSnippet: "Start the codebase-memory knowledge-graph server and discover its tools",
		parameters: Type.Object({}),
		async execute() {
			try {
				await getClient(true);
				const names = await register();
				return { content: [{ type: "text", text: `Started ${BIN}.\nTools (${names.length}): ${names.join(", ")}` }] };
			} catch {
				throw new Error(HINT);
			}
		},
	});

	// Confirm before wiping a project's graph (disable: CBM_CONFIRM=off)
	if ((process.env.CBM_CONFIRM ?? "on") !== "off") {
		pi.on("tool_call", async (event: any, ctx: any) => {
			if (event.toolName !== "cbm_delete_project" || !ctx.hasUI) return;
			const ok = await ctx.ui.confirm("codebase-memory: delete project", "Remove a project and all its graph data?");
			if (!ok) return { block: true, reason: "Blocked by user: project deletion not approved." };
		});
	}

	void register().catch(() => undefined); // silent if binary not installed yet
}
