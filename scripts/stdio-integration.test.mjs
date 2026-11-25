import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("my-mcp loads its checkout .env and prefers process values", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "my-mcp-env-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const checkout = path.join(fixture, "checkout");
  const source = path.join(checkout, "packages", "my-mcp", "src");
  const cwd = path.join(fixture, "client");
  await Promise.all([mkdir(source, { recursive: true }), mkdir(cwd)]);
  const loader = path.join(source, "load-env.mts");
  await Promise.all([
    copyFile(new URL("../packages/my-mcp/src/load-env.ts", import.meta.url), loader),
    writeFile(path.join(checkout, ".env"), "MCP_FIXTURE_ROOT=checkout\nMCP_FIXTURE_OVERRIDE=file\n"),
    writeFile(path.join(cwd, ".env"), "MCP_FIXTURE_ROOT=client\n"),
  ]);
  const entry = pathToFileURL(loader).href;
  const env = { ...process.env, MCP_FIXTURE_OVERRIDE: "" };
  delete env.MCP_FIXTURE_ROOT;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--preserve-symlinks",
    "--input-type=module",
    "--eval",
    `const { loadCheckoutEnv } = await import(${JSON.stringify(entry)});
     loadCheckoutEnv();
     console.log(JSON.stringify([process.env.MCP_FIXTURE_ROOT, process.env.MCP_FIXTURE_OVERRIDE]));`,
  ], { cwd, env });
  assert.deepEqual(JSON.parse(stdout), ["checkout", ""]);
});

test("my-mcp exposes all seven tools over stdio without Atlassian credentials", { timeout: 45_000 }, async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "packages/my-mcp/src/index.ts"],
    cwd: root,
    env: {
      DOCS_ROOT: fileURLToPath(new URL("../fixtures/docs", import.meta.url)),
      DOCS_IGNORE_DIRS: "",
      DOCS_SITEMAP_URL: "",
      JIRA_BASE_URL: "",
      JIRA_PAT: "",
      CONFLUENCE_BASE_URL: "",
      CONFLUENCE_PAT: "",
    },
  });
  const client = new Client({ name: "my-mcp-stdio-integration", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);

  assert.equal(client.getServerVersion().name, "my-mcp");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "confluence_get_page", "confluence_search", "jira_get_issue", "jira_search",
    "list_docs", "read_doc", "search_docs",
  ]);

  const issue = await client.callTool({ name: "jira_get_issue", arguments: { key: "TEST-123" } });
  assert.equal(issue.isError, true);
  assert.match(issue.content[0].text, /Missing Jira config/);
  const page = await client.callTool({ name: "confluence_get_page", arguments: { pageId: "123" } });
  assert.equal(page.isError, true);
  assert.match(page.content[0].text, /Missing Confluence config/);

  const result = await client.callTool({ name: "read_doc", arguments: { path: "guides/onboarding.md" } });
  assert.ok(!result.isError);
  assert.match(result.content[0].text, /Onboarding Guide/);
});
