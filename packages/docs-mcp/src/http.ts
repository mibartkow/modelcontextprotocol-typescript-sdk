import { startMcpHttpServer } from "@my-mcp/mcp-http";
import { loadEnvFile } from "./load-env.js";
import { createDocsServer } from "./server.js";

loadEnvFile();
startMcpHttpServer({
  name: "docs-mcp",
  portVariable: "DOCS_HTTP_PORT",
  defaultPort: 3101,
  createMcpServer: createDocsServer,
  source: process.env.DOCS_SITEMAP_URL?.trim() ? "website" : "local Markdown",
});
