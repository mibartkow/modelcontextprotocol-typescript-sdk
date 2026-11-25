import { startMcpHttpServer } from "@my-mcp/mcp-http";
import { loadEnvFile } from "./load-env.js";
import { createJiraServer } from "./server.js";

loadEnvFile();
startMcpHttpServer({
  name: "jira-mcp",
  portVariable: "JIRA_HTTP_PORT",
  defaultPort: 3102,
  createMcpServer: createJiraServer,
});
