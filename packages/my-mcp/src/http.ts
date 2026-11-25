import { startMcpHttpServer } from "@my-mcp/mcp-http";
import { loadCheckoutEnv } from "./load-env.js";
import { createMyMcpServer, serverName } from "./server.js";

loadCheckoutEnv();
startMcpHttpServer({
  name: serverName,
  portVariable: "MY_MCP_HTTP_PORT",
  defaultPort: 3100,
  createMcpServer: createMyMcpServer,
  source: process.env.DOCS_SITEMAP_URL?.trim() ? "website" : "local Markdown",
});
