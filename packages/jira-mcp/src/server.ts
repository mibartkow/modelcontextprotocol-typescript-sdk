import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jiraFetch, loadJiraConfig } from "./client.js";

/** Jira Server / Data Center REST API v2 */
const API = "/rest/api/2";

export function createJiraServer(): McpServer {
  const server = new McpServer({
    name: "jira-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "jira_search",
    {
      title: "Search Jira issues",
      description: "Runs a JQL search against Jira Server/Data Center REST API v2.",
      inputSchema: {
        jql: z.string().min(1).describe("JQL query, e.g. project = ABC ORDER BY updated DESC"),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(50)
          .default(10)
          .describe("Maximum number of issues to return"),
      },
    },
    async ({ jql, maxResults }) => {
      try {
        const config = loadJiraConfig();
        const data = await jiraFetch(
          config,
          `${API}/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "jira_get_issue",
    {
      title: "Get Jira issue",
      description: "Fetches a single Jira Server/Data Center issue by key (e.g. ABC-123).",
      inputSchema: {
        key: z.string().min(1).describe("Issue key, e.g. ABC-123"),
      },
    },
    async ({ key }) => {
      try {
        const config = loadJiraConfig();
        const data = await jiraFetch(
          config,
          `${API}/issue/${encodeURIComponent(key)}`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );

  return server;
}
