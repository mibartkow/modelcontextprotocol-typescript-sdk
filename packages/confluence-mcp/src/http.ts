import { startMcpHttpServer } from "@my-mcp/mcp-http";
import { loadEnvFile } from "./load-env.js";
import { createConfluenceServer } from "./server.js";

loadEnvFile();
startMcpHttpServer({
  name: "confluence-mcp",
  portVariable: "CONFLUENCE_HTTP_PORT",
  defaultPort: 3103,
  createMcpServer: createConfluenceServer,
});
