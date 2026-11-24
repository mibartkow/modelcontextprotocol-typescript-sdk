import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.resolve(root, "fixtures", "docs");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "packages/docs-mcp/src/index.ts"],
  cwd: root,
  env: { DOCS_ROOT: docsRoot },
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
  throw new Error(`Expected Markdown docs, got count=${listJson.count}`);
}
if (listJson.files.some((f) => String(f).includes("node_modules/"))) {
  throw new Error("list_docs leaked node_modules paths");
}
console.log("list_docs count:", listJson.count);
console.log("list_docs sample:", listJson.files.slice(0, 5));
assert.equal("root" in listJson, false);
const firstPage = await client.callTool({ name: "list_docs", arguments: { limit: 1 } });
const page = JSON.parse(firstPage.content[0].text);
assert.deepEqual(page.files, listJson.files.slice(0, 1));
assert.equal(page.nextOffset, 1);

const searched = await client.callTool({
  name: "search_docs",
  arguments: { query: "onboarding", limit: 5 },
});
const searchText = searched.content?.[0]?.text ?? "";
const searchJson = JSON.parse(searchText);
if (!searchJson.count || searchJson.count < 1) {
  throw new Error(`Expected onboarding search hits, got count=${searchJson.count}`);
}
console.log("search_docs:", JSON.stringify(searchJson, null, 2));

const samplePath = listJson.files.find((f) => f.endsWith("intro.md")) ?? listJson.files[0];
const read = await client.callTool({
  name: "read_doc",
  arguments: { path: samplePath },
});
console.log("read_doc:", samplePath, read.content?.[0]?.text?.slice(0, 120));
assert.equal(read.structuredContent.nextOffset, null);
const excerpt = await client.callTool({
  name: "read_doc",
  arguments: { path: samplePath, offset: 2, limit: 8 },
});
assert.equal(excerpt.content[0].text, read.content[0].text.slice(2, 10));
assert.equal(excerpt.structuredContent.nextOffset, 10);

await client.close();
console.log("smoke-docs OK");
