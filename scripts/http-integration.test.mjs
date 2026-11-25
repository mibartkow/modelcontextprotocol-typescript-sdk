import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const host = "127.0.0.1";
const standalone = [
  {
    name: "docs-mcp",
    portVariable: "DOCS_HTTP_PORT",
    env: { DOCS_ROOT: path.join(root, "fixtures", "docs"), DOCS_SITEMAP_URL: "", DOCS_IGNORE_DIRS: "" },
    tool: "list_docs",
    args: { limit: 1 },
    expected: {
      count: 1,
      total: 3,
      documents: [{ path: "architecture.md" }],
      nextOffset: 1,
    },
  },
  {
    name: "jira-mcp",
    portVariable: "JIRA_HTTP_PORT",
    upstreamPrefix: "JIRA",
    tool: "jira_get_issue",
    args: { key: "TEST-123" },
    upstreamPath: "/rest/api/2/issue/TEST-123",
    expected: { key: "TEST-123", fields: { summary: "Fixture issue" } },
  },
  {
    name: "confluence-mcp",
    portVariable: "CONFLUENCE_HTTP_PORT",
    upstreamPrefix: "CONFLUENCE",
    tool: "confluence_get_page",
    args: { pageId: "123" },
    upstreamPath: "/rest/api/content/123?expand=body.storage,version,space",
    expected: { id: "123", title: "Fixture page" },
  },
];
const servers = [...standalone, {
  name: "my-mcp",
  portVariable: "MY_MCP_HTTP_PORT",
  tools: standalone,
}];
const unifiedTools = [
  "confluence_get_page", "confluence_search", "jira_get_issue", "jira_search",
  "list_docs", "read_doc", "search_docs",
];
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fixture-client", version: "1.0.0" },
  },
};
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

async function listen(server) {
  server.listen(0, host);
  await once(server, "listening");
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitFor(predicate, signal, message) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(20, undefined, { signal });
  }
  assert.fail(message());
}

function start(t, { name, portVariable }, port, env = {}) {
  // Emit the signal inside the child for Windows, where kill("SIGTERM") terminates it immediately.
  const bootstrap = `
    import { pathToFileURL } from "node:url";
    if (process.send) {
      process.once("message", () => {
        process.emit("SIGTERM");
        process.send("stopping", () => process.disconnect());
      });
    }
    await import(pathToFileURL(process.argv[1]).href);
  `;
  const child = spawn(process.execPath, [
    "--import", "tsx", "--input-type=module", "--eval", bootstrap,
    path.join(root, "packages", name, "src", "http.ts"),
  ], {
    cwd: root,
    env: { ...process.env, ...env, [portVariable]: String(port) },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const lines = [];
  const records = [];
  createInterface({ input: child.stderr }).on("line", (line) => {
    lines.push(line);
    if (line.startsWith("{")) records.push(JSON.parse(line));
  });
  const completion = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await completion;
  });
  return { child, lines, records, completion, portVariable };
}

async function startListening(t, fixture, env) {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const endpoint = new URL(`http://${host}:${port}/mcp`);
  const server = start(t, fixture, port, env);
  await waitFor(() => {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      assert.fail(`Server exited before listening:\n${server.lines.join("\n")}`);
    }
    return server.lines.some((line) => line.includes(`Streamable HTTP on ${endpoint.href}`));
  }, t.signal, () => `Server never started:\n${server.lines.join("\n")}`);
  return { ...server, endpoint, port };
}

async function openRequest(endpoint) {
  const body = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const req = request(endpoint, {
    method: "POST",
    agent: false,
    headers: { ...headers, "Content-Length": Buffer.byteLength(body), Expect: "100-continue" },
  });
  const ready = once(req, "continue");
  req.flushHeaders();
  await ready;
  return { req, body };
}

async function connectStdio(t, name, env) {
  const client = new Client({ name: "stdio-parity", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", path.join(root, "packages", name, "src", "index.ts")],
    cwd: root,
    env,
    stderr: "pipe",
  }));
  return client;
}

for (const fixture of servers) {
  test(`${fixture.name} Streamable HTTP`, { timeout: 60_000 }, async (t) => {
    const tools = fixture.tools ?? [fixture];
    const env = {};
    const upstreamCalls = new Map();
    let failedSource;
    for (const tool of tools) {
      Object.assign(env, tool.env);
      if (!tool.upstreamPath) continue;

      const calls = [];
      upstreamCalls.set(tool.tool, calls);
      const upstream = createServer((req, res) => {
        calls.push({ path: req.url, authorization: req.headers.authorization });
        if (tool.upstreamPrefix === failedSource) {
          res.writeHead(503).end();
          return;
        }
        if (req.url.startsWith("/rest/api/2/search?") || req.url.startsWith("/rest/api/content/search?")) {
          const url = new URL(req.url, "http://localhost");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(Object.fromEntries(url.searchParams)));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tool.expected));
      });
      env[`${tool.upstreamPrefix}_BASE_URL`] = `http://${host}:${await listen(upstream)}`;
      env[`${tool.upstreamPrefix}_PAT`] = "fixture-upstream-token";
      t.after(() => close(upstream));
    }

    const { child, lines, records, completion, endpoint, port } = await startListening(t, fixture, env);

    const transport = new StreamableHTTPClientTransport(endpoint);
    const client = new Client({ name: "http-integration", version: "1.0.0" });
    t.after(() => client.close());
    await client.connect(transport);
    assert.equal(client.getServerVersion().name, fixture.name);
    assert.equal(transport.sessionId, undefined);
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
    for (const tool of tools) {
      assert.ok(listed.has(tool.tool));
      const result = await client.callTool({ name: tool.tool, arguments: tool.args });
      assert.ok(!result.isError);
      assert.deepEqual(JSON.parse(result.content[0].text), tool.expected);
      if (tool.upstreamPath) {
        assert.deepEqual(upstreamCalls.get(tool.tool), [{
          path: tool.upstreamPath,
          authorization: "Bearer fixture-upstream-token",
        }]);
      }
    }

    if (fixture.tools) {
      const stdio = await connectStdio(t, fixture.name, env);
      const legacy = Object.fromEntries(await Promise.all(standalone.map(async ({ name }) =>
        [name, await connectStdio(t, name, env)]
      )));
      const sortTools = (entries) => [...entries].sort((a, b) => a.name.localeCompare(b.name));
      const catalog = sortTools((await client.listTools()).tools);
      assert.deepEqual(catalog.map(({ name }) => name), unifiedTools);
      assert.deepEqual(sortTools((await stdio.listTools()).tools), catalog);
      const standaloneCatalogs = await Promise.all(Object.values(legacy).map(async (server) =>
        (await server.listTools()).tools
      ));
      assert.deepEqual(sortTools(standaloneCatalogs.flat()), catalog);

      const calls = [
        ...tools.map(({ name, tool, args }) => [name, tool, args]),
        ["docs-mcp", "search_docs", { query: "onboarding" }],
        ["docs-mcp", "read_doc", { path: "guides/onboarding.md", offset: 2, limit: 8 }],
        ["jira-mcp", "jira_search", { jql: "project = TEST", startAt: 2 },
          { jql: "project = TEST", startAt: "2", maxResults: "10", fields: "summary,status,issuetype,updated" }],
        ["confluence-mcp", "confluence_search", { cql: "type = page", start: 1 },
          { cql: "type = page", start: "1", limit: "10" }],
      ];
      for (const [source, name, args, expected] of calls) {
        const call = { name, arguments: args };
        const baseline = await legacy[source].callTool(call);
        assert.ok(!baseline.isError, JSON.stringify(baseline));
        if (expected) assert.deepEqual(JSON.parse(baseline.content[0].text), expected);
        assert.deepEqual(await client.callTool(call), baseline);
        assert.deepEqual(await stdio.callTool(call), baseline);
      }

      const issue = { name: "jira_get_issue", arguments: { key: "TEST-123" } };
      const page = { name: "confluence_get_page", arguments: { pageId: "123" } };
      for (const [source, unavailable, available] of [["JIRA", issue, page], ["CONFLUENCE", page, issue]]) {
        failedSource = source;
        for (const server of [client, stdio]) {
          const result = await server.callTool(unavailable);
          assert.equal(result.isError, true);
          assert.match(result.content[0].text, /HTTP 503/);
          assert.ok(!(await server.callTool(available)).isError);
          assert.ok(!(await server.callTool({ name: "list_docs" })).isError);
        }
      }
    }

    const response = await fetch(`${endpoint.href}?private=fixture-query`, {
      headers: {
        Origin: `http://localhost:${port}`,
        "X-Request-ID": "fixture-client-id",
        Authorization: "Bearer fixture-client-token",
      },
    });
    const getId = response.headers.get("x-request-id");
    assert.match(getId, uuid);
    assert.equal(response.status, 405);
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST for stateless mode." },
      id: null,
    });

    const local = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, Origin: endpoint.origin },
      body: JSON.stringify(initialize),
    });
    assert.equal(local.status, 200);
    assert.equal(local.headers.get("mcp-session-id"), null);
    assert.match(local.headers.get("x-request-id"), uuid);
    assert.notEqual(local.headers.get("x-request-id"), getId);
    await local.text();

    const denied = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, Origin: "https://outside.example" },
      body: JSON.stringify(initialize),
    });
    assert.equal(denied.status, 403);
    const deniedId = denied.headers.get("x-request-id");
    assert.match(deniedId, uuid);
    assert.equal((await denied.json()).error.message, "Origin not allowed");

    const badHostRequest = request(endpoint, { headers: { Host: "outside.example" } });
    const badHostResponse = once(badHostRequest, "response");
    badHostRequest.end();
    const [badHost] = await badHostResponse;
    assert.equal(badHost.statusCode, 403);
    const badHostId = badHost.headers["x-request-id"];
    assert.match(badHostId, uuid);
    badHost.resume();
    await once(badHost, "end");

    const invalid = await fetch(endpoint, { method: "POST", headers, body: '{"fixture-body":' });
    const invalidId = invalid.headers.get("x-request-id");
    assert.match(invalidId, uuid);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, -32700);

    const wrongAccept = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, Accept: "application/json" },
      body: JSON.stringify(initialize),
    });
    assert.equal(wrongAccept.status, 406);
    assert.equal(typeof (await wrongAccept.json()).error.code, "number");

    const unknownMethod = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "unknown/fixture" }),
    });
    assert.equal(unknownMethod.status, 200);
    const mcpErrorId = unknownMethod.headers.get("x-request-id");
    assert.match(mcpErrorId, uuid);
    assert.match(await unknownMethod.text(), /"code":-32601/);
    await client.close();

    const { req: aborted } = await openRequest(endpoint);
    aborted.on("error", () => {});
    aborted.destroy();
    const abortRecord = await waitFor(
      () => records.find((record) => record.event === "http.request" && record.aborted),
      t.signal,
      () => "HTTP abort telemetry was missing",
    );
    assert.equal(abortRecord.status, null);

    const active = await openRequest(endpoint);
    const stopping = once(child, "message");
    child.send("stop");
    const [message] = await stopping;
    assert.equal(message, "stopping");
    const finished = once(active.req, "response");
    active.req.end(active.body);
    const [notification] = await finished;
    assert.equal(notification.statusCode, 202);
    notification.resume();
    await once(notification, "end");
    assert.deepEqual(await completion, [0, null], lines.join("\n"));

    const requests = records.filter((record) => record.event === "http.request");
    assert.equal(requests.find((record) => record.requestId === getId)?.status, 405);
    assert.equal(requests.find((record) => record.requestId === deniedId)?.status, 403);
    assert.equal(requests.find((record) => record.requestId === badHostId)?.status, 403);
    assert.equal(requests.find((record) => record.requestId === invalidId)?.status, 400);
    assert.equal(requests.find((record) => record.requestId === mcpErrorId)?.status, 200);
    assert.equal(requests.filter((record) => record.aborted).length, 1);
    assert.equal(new Set(requests.map((record) => record.requestId)).size, requests.length);
    for (const record of requests) {
      assert.deepEqual(Object.keys(record).sort(), [
        "aborted", "durationMs", "event", "method", "requestId", "server", "status",
      ]);
      assert.equal(record.server, fixture.name);
      assert.match(record.requestId, uuid);
      assert.ok(Number.isInteger(record.durationMs) && record.durationMs >= 0);
    }
    assert.doesNotMatch(lines.join("\n"), /fixture-(?:body|query|client-id|client-token|upstream-token)/);
  });

  test(`${fixture.name} rejects invalid HTTP port configuration`, { timeout: 45_000 }, async (t) => {
    const { completion, lines, portVariable } = start(t, fixture, "0");
    assert.deepEqual(await completion, [1, null]);
    assert.ok(lines.some((line) => line.includes(`${portVariable} must be a decimal port between 1 and 65535`)));
  });
}

test("docs factory failure is correlated without raw configuration in logs", { timeout: 45_000 }, async (t) => {
  const { lines, records, endpoint } = await startListening(t, standalone[0], {
    DOCS_SITEMAP_URL: "fixture-invalid-sitemap",
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(initialize),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    error: { code: -32603, message: "Internal server error" },
    id: null,
  });
  const requestId = response.headers.get("x-request-id");
  assert.match(requestId, uuid);
  await waitFor(
    () => records.find((record) => record.event === "http.request" && record.requestId === requestId),
    t.signal,
    () => lines.join("\n"),
  );
  assert.deepEqual(records.find((record) => record.event === "http.handler_error"), {
    event: "http.handler_error",
    server: "docs-mcp",
    requestId,
    phase: "factory",
  });
  assert.doesNotMatch(lines.join("\n"), /fixture-invalid-sitemap/);
});

test("my-mcp serves Docusaurus with Atlassian unconfigured", { timeout: 60_000 }, async (t) => {
  const site = createServer((req, res) => {
    if (req.url === "/docs/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(`<urlset><url><loc>${origin}/docs/intro</loc></url></urlset>`);
    } else if (req.url === "/docs/intro") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<main><article><div class="theme-doc-markdown"><h1>Fixture</h1><p>Website onboarding</p></div></article></main>');
    } else {
      res.writeHead(404).end();
    }
  });
  const origin = `http://${host}:${await listen(site)}`;
  t.after(() => close(site));
  const fixture = { name: "my-mcp", portVariable: "MY_MCP_HTTP_PORT" };
  const env = {
    ...standalone[0].env,
    DOCS_SITEMAP_URL: `${origin}/docs/sitemap.xml`,
    DOCS_SITE_PATH: "/docs",
    JIRA_BASE_URL: "",
    CONFLUENCE_BASE_URL: "",
  };
  const { endpoint } = await startListening(t, fixture, env);
  const http = new Client({ name: "http-website-fixture", version: "1.0.0" });
  t.after(() => http.close());
  await http.connect(new StreamableHTTPClientTransport(endpoint));
  const stdio = await connectStdio(t, fixture.name, env);
  const sourceUrl = `${origin}/docs/intro`;
  for (const client of [http, stdio]) {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).sort(), unifiedTools);
    for (const [name, args] of [
      ["jira_search", { jql: "project = TEST" }],
      ["confluence_search", { cql: "type = page" }],
    ]) {
      const error = await client.callTool({ name, arguments: args });
      assert.equal(error.isError, true);
      assert.match(error.content[0].text, /Missing (Jira|Confluence) config/);
    }
    const listing = await client.callTool({ name: "list_docs" });
    assert.deepEqual(JSON.parse(listing.content[0].text).documents, [{ path: "docs/intro", sourceUrl }]);
    const search = await client.callTool({ name: "search_docs", arguments: { query: "onboarding" } });
    assert.equal(JSON.parse(search.content[0].text).matches[0].sourceUrl, sourceUrl);
    const read = await client.callTool({ name: "read_doc", arguments: { path: "docs/intro" } });
    assert.equal(read.structuredContent.sourceUrl, sourceUrl);
    assert.match(read.content[0].text, /Website onboarding/);
  }
});
