import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadEnvFile } from "./load-env.js";
import { createDocsServer } from "./server.js";

loadEnvFile();
const port = Number(process.env.DOCS_HTTP_PORT ?? 3101);

const host = "127.0.0.1";
const localOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
const app = createMcpExpressApp({ host });

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin !== undefined && !localOrigins.has(origin)) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Origin not allowed" },
    });
    return;
  }
  next();
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createDocsServer();
  try {
    // Stateless mode requires an explicit undefined generator (SDK docs).
    const options = {
      sessionIdGenerator: undefined,
    } as unknown as StreamableHTTPServerTransportOptions;
    const transport = new StreamableHTTPServerTransport(options);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("docs-mcp HTTP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  } finally {
    await server.close();
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST for stateless mode." },
    id: null,
  });
});

app.listen(port, host, () => {
  console.error(`docs-mcp Streamable HTTP on http://${host}:${port}/mcp`);
});
