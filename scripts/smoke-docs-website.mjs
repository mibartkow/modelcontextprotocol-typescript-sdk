import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cwd = await mkdtemp(path.join(tmpdir(), "docs-mcp-website-"));
const requests = [];
const site = createServer((request, response) => {
  requests.push(request.url);
  switch (request.url) {
    case "/handbuch/sitemap.xml":
      response.setHeader("Content-Type", "application/xml");
      response.end(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${origin}/docs-sitemap.xml</loc></sitemap>
      </sitemapindex>`);
      break;
    case "/docs-sitemap.xml":
      response.setHeader("Content-Type", "application/xml");
      response.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${origin}/handbuch/docs/intro</loc></url>
        <url><loc>${origin}/handbuch/docs/unavailable</loc></url>
        <url><loc>${origin}/handbuch/blog/post</loc></url>
      </urlset>`);
      break;
    case "/handbuch/docs/intro":
      response.writeHead(301, { Location: "/handbuch/docs/intro/" }).end();
      break;
    case "/handbuch/docs/intro/":
      response.setHeader("Content-Type", "text/html");
      response.end(`<main><article><nav>navigation only</nav>
        <div class="theme-doc-markdown"><h1>Handbuch</h1><p>Onboarding für 👋 Teams.</p></div>
        <footer>footer only</footer></article></main>`);
      break;
    default:
      response.writeHead(404).end();
  }
});

site.listen(0, "127.0.0.1");
await once(site, "listening");
const origin = `http://127.0.0.1:${site.address().port}`;
const client = new Client({ name: "smoke-docs-website", version: "1.0.0" });

try {
  await writeFile(path.join(cwd, ".env"), [
    `DOCS_SITEMAP_URL=${origin}/unrelated/sitemap.xml`,
    "DOCS_SITE_PATH=/unrelated",
  ].join("\n"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      path.join(root, "node_modules/tsx/dist/loader.mjs"),
      path.join(root, "packages/docs-mcp/src/index.ts"),
    ],
    cwd,
    env: {
      DOCS_SITEMAP_URL: `${origin}/handbuch/sitemap.xml`,
      DOCS_SITE_PATH: "/handbuch/docs",
    },
  });
  await client.connect(transport);

  const call = (name, args) => client.callTool({ name, arguments: args });
  const list = JSON.parse((await call("list_docs", { limit: 1 })).content[0].text);
  const sourceUrl = `${origin}/handbuch/docs/intro`;
  assert.deepEqual(list.files, ["handbuch/docs/intro"]);
  assert.deepEqual(list.sources, { "handbuch/docs/intro": sourceUrl });
  assert.equal(list.nextOffset, 1);
  assert.equal(list.total, 2);
  assert.equal(list.truncated, false);
  assert.deepEqual(requests, ["/handbuch/sitemap.xml", "/docs-sitemap.xml"]);

  const search = JSON.parse((await call("search_docs", { query: "onboarding" })).content[0].text);
  assert.equal(search.count, 1);
  assert.equal(search.scanned, 1);
  assert.equal(search.partial, true);
  assert.equal(search.matches[0].sourceUrl, sourceUrl);
  assert.doesNotMatch(search.matches[0].snippet, /navigation only|footer only/);

  const read = await call("read_doc", { path: list.files[0], limit: 8 });
  assert.equal(read.content[0].text, `Source: ${sourceUrl}\n\nHandbuch`);
  assert.equal(read.structuredContent.nextOffset, 8);
  assert.equal(read.structuredContent.sourceUrl, sourceUrl);
  const continuation = await call("read_doc", { path: list.files[0], offset: read.structuredContent.nextOffset });
  assert.equal(continuation.content[0].text, `Source: ${sourceUrl}\n\n\n\nOnboarding für 👋 Teams.`);
  assert.equal(continuation.structuredContent.nextOffset, null);
  assert.equal((await call("read_doc", { path: search.matches[0].sourceUrl })).isError, true);
  assert.ok(!requests.includes("/handbuch/blog/post"));
  assert.equal(requests.filter((url) => url === "/handbuch/docs/intro/").length, 1);
  console.log("smoke-docs-website OK");
} finally {
  await client.close();
  await new Promise((resolve, reject) => site.close((error) => error ? reject(error) : resolve()));
  await rm(cwd, { recursive: true, force: true });
}
