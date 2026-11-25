import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerConfluenceTools } from "@my-mcp/confluence-mcp/tools";
import { registerDocsTools } from "@my-mcp/docs-mcp/tools";
import { registerJiraTools } from "@my-mcp/jira-mcp/tools";

export const serverName = "my-mcp";

export function createMyMcpServer(): McpServer {
  const server = new McpServer({ name: serverName, version: "1.0.0" });
  registerDocsTools(server);
  registerJiraTools(server);
  registerConfluenceTools(server);
  return server;
}
