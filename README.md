# my-mcp

Monorepo with three separate Model Context Protocol servers (TypeScript SDK):

| Server | Package | Transport | Purpose |
|--------|---------|-----------|---------|
| `docs-mcp` | `packages/docs-mcp` | stdio / HTTP | DigiDEV Docusaurus (`.md`/`.mdx` under `DOCS_ROOT`) |
| `jira-mcp` | `packages/jira-mcp` | stdio / HTTP | Jira issues via REST |
| `confluence-mcp` | `packages/confluence-mcp` | stdio / HTTP | Confluence pages via REST |

## Prerequisites

- Node.js 18+
- **Atlassian Server / Data Center** (not Cloud) with REST access
- Auth: Personal Access Token (preferred) or username + password

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your Server/DC base URLs and PAT (or username/password)
```

## Local testing (stdio)

### MCP Inspector

```bash
npm run inspect:docs
# npm run inspect:jira
# npm run inspect:confluence
```

In the Inspector UI: list tools, then call e.g. `list_docs` / `search_docs` / `read_doc`.

For docs, `DOCS_ROOT` should point at the DigiDEV Docusaurus repo (see `.env.example`):

```bash
# PowerShell
$env:DOCS_ROOT = "C:\Users\BartkowiakMirko\IdeaProjects\digidev-docusaurs"
npm run inspect:docs
```

### Cursor

Project config: [`.cursor/mcp.json`](.cursor/mcp.json). Reload MCP servers in Cursor after install. Ensure workspace env / `.env` values are available for Jira and Confluence.

### Manual stdio start

```bash
$env:DOCS_ROOT = "C:\Users\BartkowiakMirko\IdeaProjects\digidev-docusaurs"
npm run docs
```

Logs go to **stderr** only (stdout is reserved for MCP JSON-RPC).

## Streamable HTTP (multi-agent)

Same tools, remote-friendly transport:

```bash
npm run docs:http        # http://127.0.0.1:3101/mcp
npm run jira:http        # http://127.0.0.1:3102/mcp
npm run confluence:http  # http://127.0.0.1:3103/mcp
```

Inspector against HTTP:

```bash
npx @modelcontextprotocol/inspector --server-url http://127.0.0.1:3101/mcp --transport http
```

## Tools

### docs-mcp

Default `DOCS_ROOT`: DigiDEV Docusaurus (`digidev-docusaurs`). Indexes `.md`/`.mdx`, skips `node_modules`, `.git`, `.docusaurus`, …

- `list_docs` — list doc files under `DOCS_ROOT`
- `search_docs` — case-insensitive content search
- `read_doc` — read one relative path (path-traversal protected)

### jira-mcp (Server/DC, REST API v2)

- `jira_search` — JQL search via `/rest/api/2/search`
- `jira_get_issue` — issue by key via `/rest/api/2/issue/{key}`

Env: `JIRA_BASE_URL`, plus `JIRA_PAT` **or** `JIRA_USERNAME` + `JIRA_PASSWORD`

### confluence-mcp (Server/DC)

- `confluence_search` — CQL search
- `confluence_get_page` — page by ID (`body.storage` expanded)

Env: `CONFLUENCE_BASE_URL` (Server-Host, **ohne** `/wiki`), plus `CONFLUENCE_PAT` **or** `CONFLUENCE_USERNAME` + `CONFLUENCE_PASSWORD`

Self-signed TLS nur zum Dev-Test: `NODE_TLS_REJECT_UNAUTHORIZED=0` (siehe `.env.example`).

## Recommended order

1. Verify **docs-mcp** against DigiDEV Docusaurus + Inspector (no Atlassian credentials)
2. Wire Cursor `mcp.json`
3. Server/DC-URLs + PAT in `.env` setzen und **jira-mcp** / **confluence-mcp** testen
4. Use `*:http` when multiple agents need the same server process
