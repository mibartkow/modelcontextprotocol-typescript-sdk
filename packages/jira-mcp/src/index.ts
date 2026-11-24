import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./load-env.js";
import { createJiraServer } from "./server.js";

async function main(): Promise<void> {
  loadEnvFile();
  const server = createJiraServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("jira-mcp listening on stdio");
}

main().catch((error: unknown) => {
  console.error("jira-mcp failed to start:", error);
  process.exit(1);
});
