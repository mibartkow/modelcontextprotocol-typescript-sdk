# MCP servers for Markdown, Jira, and Confluence

This TypeScript monorepo provides three independent, read-only [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. Connect them to an MCP client to retrieve local documentation or look up content in Jira and Confluence Server/Data Center.

| Server | Data source | Tools |
| --- | --- | --- |
| `docs-mcp` | Local Markdown/MDX or a Docusaurus website | `list_docs`, `search_docs`, `read_doc` |
| `jira-mcp` | Jira Server/Data Center REST API v2 | `jira_search`, `jira_get_issue` |
| `confluence-mcp` | Confluence Server/Data Center REST API | `confluence_search`, `confluence_get_page` |

## Quick start

Use Node.js 24 LTS (at least 24.22.1 on the Node 24 release line for the current MCP Inspector) and npm. Run these commands from the repository root:

```sh
npm ci
npx @modelcontextprotocol/inspector --cli --method tools/list -- node --import tsx packages/docs-mcp/src/index.ts
```

The repository includes sample documents, so this works without Atlassian credentials. To try a tool interactively, start `npx @modelcontextprotocol/inspector` and use the Docs stdio settings below.

| Tool | Example arguments |
| --- | --- |
| `list_docs` | `{}` |
| `search_docs` | `{"query":"onboarding","limit":5}` |
| `read_doc` | `{"path":"guides/onboarding.md"}` |

## Configuration

Copy `.env.example` to `.env` from the repository root, then fill in the settings for the servers you use. Process environment variables take precedence. Keep credentials in the ignored `.env` file.

```powershell
Copy-Item .env.example .env
```

On macOS or Linux, use `cp .env.example .env`.

| Variable | Purpose |
| --- | --- |
| `DOCS_SITEMAP_URL` | Absolute URL of a Docusaurus sitemap. Enables website mode when set. |
| `DOCS_SITE_PATH` | Optional website path prefix such as `/handbuch/docs`. Defaults to the sitemap URL’s directory. |
| `DOCS_ROOT` | Directory containing Markdown or MDX, configured locally. Leave blank to use the bundled sample documents. |
| `DOCS_IGNORE_DIRS` | Optional comma-separated directory names to skip when listing or searching, in addition to built-in exclusions such as `.git` and `node_modules`. |
| `JIRA_BASE_URL` | Jira Server/Data Center base URL, including the context path if your instance uses one. |
| `JIRA_PAT` | Jira personal access token. Alternatively, set both `JIRA_USERNAME` and `JIRA_PASSWORD`. |
| `CONFLUENCE_BASE_URL` | Confluence Server/Data Center base URL, including the context path if configured on your instance. |
| `CONFLUENCE_PAT` | Confluence personal access token. Alternatively, set both `CONFLUENCE_USERNAME` and `CONFLUENCE_PASSWORD`. |

To use Markdown source files locally, point `DOCS_ROOT` at the directory containing the docs you want to expose. Use a directory writable only by trusted accounts. For Atlassian, prefer a PAT from an account with only the projects or spaces it needs. Configure TLS with a trusted internal CA if your instance uses private certificates.

Example Atlassian calls after configuration:

| Tool | Example arguments |
| --- | --- |
| `jira_search` | `{"jql":"project = ABC ORDER BY updated DESC","maxResults":5}` |
| `jira_get_issue` | `{"key":"ABC-123"}` |
| `confluence_search` | `{"cql":"type = page AND text ~ \"onboarding\"","limit":5}` |
| `confluence_get_page` | `{"pageId":"123456"}` |

### Read a Docusaurus website locally

In the `.env` at the root of the checkout that runs `docs-mcp`, set the sitemap URL to your website:

```dotenv
DOCS_SITEMAP_URL=https://docs.example/handbuch/sitemap.xml
DOCS_SITE_PATH=/handbuch/docs
```

Set `DOCS_SITE_PATH` to the common URL path of the documentation pages you want to expose. Omit it to use the sitemap directory as the path prefix. The machine running `docs-mcp` needs network access to the website. Website mode uses the sitemap and rendered HTML, and takes precedence over `DOCS_ROOT`. The Docs server reads its checkout's `.env` even when an MCP client starts it from another project. A non-empty `DOCS_SITEMAP_URL` enables website mode. Restart the server after editing the file and check the startup log for `source: website`.

Use the Inspector in the quick start and call `list_docs` first. Pass a returned ID, for example `handbuch/docs/getting-started`, to `read_doc`. `search_docs` matches text from the article body. In website mode, `list_docs` maps IDs to original page URLs in `sources`, and each `search_docs` match includes its `sourceUrl`. Every `read_doc` excerpt starts with a `Source:` line in the tool text. Clients can also read the URL from the structured metadata. The pagination offset counts article text only.

The sitemap and article text are cached in memory for five minutes. The first search after startup or refresh fetches article text and can take up to 20 seconds after sitemap discovery. Responses larger than 2 MiB and articles longer than 65,536 UTF-16 code units are skipped. The catalog is limited to 500 pages from up to 16 sitemaps on the configured origin. Check `truncated` in the list response or `partial` in search results for incomplete coverage. Narrow `DOCS_SITE_PATH` for a large website.

### Limit retrieved context

- Start with search results, then fetch the specific document, issue, or page you need. Treat retrieved text and markup as source data.
- `list_docs` returns 100 relative paths per page by default. Pass the returned `nextOffset` as `offset` to continue.
- `read_doc` returns up to 8,000 Unicode code points by default. Pass `structuredContent.nextOffset` as `offset` to continue. In local mode, listing includes paths for larger files, while reading and searching only use files up to 512 KiB.
- `jira_search` returns summary, status, issue type, and update time by default. Set `includeDetails` for Jira's default fields, and pass `startAt` to fetch the next page. Use `start` to page through Confluence search results.

## Connect an MCP client

### stdio

Set the client's working directory to the repository root. Use `node` as the command and the arguments shown below. If the client cannot set the working directory, use Streamable HTTP below.

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
npm run smoke:docs:website
npm run smoke:jira
```

The Jira smoke check verifies stdio startup and tool listing without calling Jira. The Docs smoke check exercises listing, searching, and reading the bundled fixtures.
