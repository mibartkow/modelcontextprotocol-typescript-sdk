import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot =
  process.env.DOCS_ROOT?.trim() ||
  path.resolve(root, "..", "digidev-docusaurs");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "packages/docs-mcp/src/index.ts"],
  cwd: root,
  env: { ...process.env, DOCS_ROOT: docsRoot },
  stderr: "pipe",
});

const client = new Client({ name: "smoke-docs", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(
  "tools:",
  tools.tools.map((t) => t.name).join(", "),
);

const listed = await client.callTool({ name: "list_docs", arguments: {} });
const listText = listed.content?.[0]?.text ?? "";
const listJson = JSON.parse(listText);

if (!listJson.count || listJson.count < 1) {
  throw new Error(`Expected DigiDEV docs, got count=${listJson.count}`);
}
if (listJson.files.some((f) => String(f).includes("node_modules/"))) {
  throw new Error("list_docs leaked node_modules paths");
}
console.log("list_docs count:", listJson.count);
console.log("list_docs sample:", listJson.files.slice(0, 5));

const searched = await client.callTool({
  name: "search_docs",
  arguments: { query: "DigiDEV", limit: 5 },
});
const searchText = searched.content?.[0]?.text ?? "";
const searchJson = JSON.parse(searchText);
if (!searchJson.count || searchJson.count < 1) {
  throw new Error(`Expected DigiDEV search hits, got count=${searchJson.count}`);
}
console.log("search_docs:", JSON.stringify(searchJson, null, 2));

const samplePath = listJson.files.find((f) => f.endsWith("intro.md")) ?? listJson.files[0];
const read = await client.callTool({
  name: "read_doc",
  arguments: { path: samplePath },
});
console.log("read_doc:", samplePath, read.content?.[0]?.text?.slice(0, 120));

await client.close();
console.log("smoke-docs OK");
