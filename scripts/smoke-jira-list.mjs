import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "packages/jira-mcp/src/index.ts"],
  cwd: root,
  stderr: "pipe",
});

const client = new Client({ name: "smoke-jira", version: "1.0.0" });
await client.connect(transport);
const tools = await client.listTools();
assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["jira_get_issue", "jira_search"]);
console.log(
  "jira tools:",
  tools.tools.map((t) => t.name).join(", "),
);
await client.close();
console.log("smoke-jira-list OK");
