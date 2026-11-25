import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCheckoutEnv } from "./load-env.js";
import { createMyMcpServer, serverName } from "./server.js";

loadCheckoutEnv();
await createMyMcpServer().connect(new StdioServerTransport());
const source = process.env.DOCS_SITEMAP_URL?.trim() ? "website" : "local Markdown";
console.error(`${serverName} listening on stdio (source: ${source})`);
