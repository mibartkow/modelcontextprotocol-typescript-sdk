import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadEnvFile } from "./load-env.js";
import { createConfluenceServer } from "./server.js";

loadEnvFile();
const port = Number(process.env.CONFLUENCE_HTTP_PORT ?? 3103);

const app = createMcpExpressApp();

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createConfluenceServer();
  try {
    const options = {
      sessionIdGenerator: undefined,
    } as unknown as StreamableHTTPServerTransportOptions;
    const transport = new StreamableHTTPServerTransport(options);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("confluence-mcp HTTP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST for stateless mode." },
    id: null,
  });
});

app.listen(port, () => {
  console.error(`confluence-mcp Streamable HTTP on http://127.0.0.1:${port}/mcp`);
});
