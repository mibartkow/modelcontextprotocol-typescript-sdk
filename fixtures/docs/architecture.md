# Architecture

Three separate MCP servers:

1. **docs-mcp** — Markdown documentation under `DOCS_ROOT`
2. **jira-mcp** — Jira Server/Data Center REST API v2 (`jira_search`, `jira_get_issue`)
3. **confluence-mcp** — Confluence Server/Data Center REST API (`confluence_search`, `confluence_get_page`)

Local development uses **stdio**. Multi-agent remote access uses **Streamable HTTP**.
