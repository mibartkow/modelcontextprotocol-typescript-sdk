import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { confluenceFetch, loadConfluenceConfig } from "./client.js";

export function createConfluenceServer(): McpServer {
  const server = new McpServer({
    name: "confluence-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "confluence_search",
    {
      title: "Search Confluence",
      description: "Searches Confluence Server/Data Center content via CQL.",
      inputSchema: {
        cql: z
          .string()
          .min(1)
          .describe('CQL query, e.g. type=page AND text ~ "onboarding"'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .default(10)
          .describe("Maximum number of results"),
      },
    },
    async ({ cql, limit }) => {
      try {
        const config = loadConfluenceConfig();
        const data = await confluenceFetch(
          config,
          `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}`,
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
    "confluence_get_page",
    {
      title: "Get Confluence page",
      description:
        "Fetches a Confluence Server/Data Center page by ID, including body storage markup.",
      inputSchema: {
        pageId: z.string().min(1).describe("Confluence page ID"),
      },
    },
    async ({ pageId }) => {
      try {
        const config = loadConfluenceConfig();
        const data = await confluenceFetch(
          config,
          `/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,version,space`,
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
