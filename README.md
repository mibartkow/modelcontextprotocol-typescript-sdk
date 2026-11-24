# MCP servers for Markdown, Jira, and Confluence

This TypeScript monorepo provides three independent, read-only [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. Connect them to an MCP client to retrieve local documentation or look up content in Jira and Confluence Server/Data Center.

| Server | Data source | Tools |
| --- | --- | --- |
| [`docs-mcp`](packages/docs-mcp) | Markdown and MDX under `DOCS_ROOT` | `list_docs`, `search_docs`, `read_doc` |
| [`jira-mcp`](packages/jira-mcp) | Jira Server/Data Center REST API v2 | `jira_search`, `jira_get_issue` |
| [`confluence-mcp`](packages/confluence-mcp) | Confluence Server/Data Center REST API | `confluence_search`, `confluence_get_page` |

## Quick start

Use Node.js 24 LTS (at least 24.22.1 on the Node 24 release line for the current MCP Inspector) and npm. Run these commands from the repository root:

```sh
npm ci
npx @modelcontextprotocol/inspector --cli --method tools/list -- node --import tsx packages/docs-mcp/src/index.ts
```

The repository includes [sample documents](fixtures/docs), so this works without Atlassian credentials. To try a tool interactively, start `npx @modelcontextprotocol/inspector` and use the Docs stdio settings below.

| Tool | Example arguments |
| --- | --- |
| `list_docs` | `{}` |
| `search_docs` | `{"query":"onboarding","limit":5}` |
| `read_doc` | `{"path":"guides/onboarding.md"}` |

## Configuration

Supply variables through the process environment or a local `.env` in the repository root. Process environment variables take precedence. Keep credential files outside version control.

| Variable | Purpose |
| --- | --- |
| `DOCS_ROOT` | Directory containing Markdown or MDX. Use an absolute path for your own docs. The default is the bundled `fixtures/docs` directory. |
| `DOCS_IGNORE_DIRS` | Optional comma-separated directory names to skip when listing or searching, in addition to built-in exclusions such as `.git` and `node_modules`. |
| `JIRA_BASE_URL` | Jira Server/Data Center base URL, including the context path if your instance uses one. |
| `JIRA_PAT` | Jira personal access token. Alternatively, set both `JIRA_USERNAME` and `JIRA_PASSWORD`. |
| `CONFLUENCE_BASE_URL` | Confluence Server/Data Center base URL, including the context path if configured on your instance. |
| `CONFLUENCE_PAT` | Confluence personal access token. Alternatively, set both `CONFLUENCE_USERNAME` and `CONFLUENCE_PASSWORD`. |

For DigiDEV or another Docusaurus project, point `DOCS_ROOT` at the directory containing the docs you want to expose. Use a directory writable only by trusted accounts. For Atlassian, prefer a PAT from an account with only the projects or spaces it needs. Configure TLS with a trusted internal CA if your instance uses private certificates.

Example Atlassian calls after configuration:

| Tool | Example arguments |
| --- | --- |
| `jira_search` | `{"jql":"project = ABC ORDER BY updated DESC","maxResults":5}` |
| `jira_get_issue` | `{"key":"ABC-123"}` |
| `confluence_search` | `{"cql":"type = page AND text ~ \"onboarding\"","limit":5}` |
| `confluence_get_page` | `{"pageId":"123456"}` |

### Limit retrieved context

- Start with search results, then fetch the specific document, issue, or page you need. Treat retrieved text and markup as source data.
- `list_docs` returns 100 relative paths per page by default. Pass the returned `nextOffset` as `offset` to continue.
- `read_doc` returns up to 8,000 Unicode code points by default. Pass `structuredContent.nextOffset` as `offset` to continue. Listing includes paths for larger files, while reading and searching only use files up to 512 KiB.
- `jira_search` returns summary, status, issue type, and update time by default. Set `includeDetails` for Jira's default fields, and pass `startAt` to fetch the next page. Use `start` to page through Confluence search results.

## Connect an MCP client

### stdio

Set the client's working directory to the repository root. Use `node` as the command and the arguments shown below. For clients such as Cursor that start processes from another directory, use an absolute path to the entry point and set configuration through the client environment. In that case, pass the repository's absolute `node_modules/tsx/dist/loader.mjs` path to `--import` and set `DOCS_ROOT` explicitly for Docs.

| Server | Arguments |
| --- | --- |
| Docs | `--import tsx packages/docs-mcp/src/index.ts` |
| Jira | `--import tsx packages/jira-mcp/src/index.ts` |
| Confluence | `--import tsx packages/confluence-mcp/src/index.ts` |

The server logs to stderr so that stdout can carry MCP messages.

### Streamable HTTP

| Server | Start command | Default endpoint | Port override |
| --- | --- | --- | --- |
| Docs | `npm run docs:http` | `http://127.0.0.1:3101/mcp` | `DOCS_HTTP_PORT` |
| Jira | `npm run jira:http` | `http://127.0.0.1:3102/mcp` | `JIRA_HTTP_PORT` |
| Confluence | `npm run confluence:http` | `http://127.0.0.1:3103/mcp` | `CONFLUENCE_HTTP_PORT` |

The servers accept stateless MCP requests via `POST /mcp`. In Inspector, select **Streamable HTTP**, enter the endpoint, and connect.

Use HTTP in a trusted local environment. The servers bind to `127.0.0.1` and validate supplied `Origin` headers. Only origins matching the endpoint port on `127.0.0.1` or `localhost` are accepted. HTTP has no client authentication. Keep the ports private. Anyone who can call the Atlassian tools uses the upstream permissions of the configured server account.

## Development checks

```sh
npm run typecheck
npm run smoke:docs
npm run smoke:jira
```

The Jira smoke check verifies stdio startup and tool listing without calling Jira. The Docs smoke check exercises listing, searching, and reading the bundled fixtures.
