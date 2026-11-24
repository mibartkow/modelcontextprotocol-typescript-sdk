import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "packages/jira-mcp/src/index.ts"],
  cwd: root,
  stderr: "pipe",
});

const client = new Client({ name: "smoke-jira", version: "1.0.0" });
await client.connect(transport);
const tools = await client.listTools();
console.log(
  "jira tools:",
  tools.tools.map((t) => t.name).join(", "),
);
await client.close();
console.log("smoke-jira-list OK");
