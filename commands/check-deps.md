---
description: "Check if required external plugins and MCP servers are installed"
---

# Dependency Check

Verify that all external plugins and MCP servers required by the xorio plugin are available.

## Check Plugins

Read `~/.claude/settings.json` and check the `enabledPlugins` object for these keys:

**Required** (workflows break without these):
- `pr-review-toolkit` — used by `/xorio:polish` and `/xorio:review`
- `ralph-wiggum` — used by `/xorio:polish --auto`
- `security-guidance` — automatic security hooks on file edits, used by polish/review workflows

**Recommended** (enhance workflows but not strictly required):
- `feature-dev` — guided feature development
- `frontend-design` — UI component development
- `superpowers` — general workflow enhancement (plan mode, brainstorming, TDD, code-reviewer)
- `commit-commands` — git commit/push/PR workflows (complements `xorio:commit-message`)
- `claude-md-management` — CLAUDE.md maintenance (used at end of polish/review workflows)
- `rust-analyzer-lsp` — compile-time diagnostics for Rust projects

For each plugin, check if a key containing that name exists in `enabledPlugins` and is set to `true`.

## Check MCP Servers

Use ToolSearch to check if the following MCP tools are discoverable:

**Required:**
- `context7` — documentation lookup. Search for tool prefix `mcp__plugin_context7_context7__`
- `ast-grep` — structural code search. Search for tool prefix `mcp__ast-grep__`
- `serena` — symbol navigation. Search for tool prefix `mcp__plugin_serena_serena__`

**Recommended:**
- `memory` — knowledge graph for cross-session context. Search for tool prefix `mcp__memory__`
- `claude-in-chrome` — browser testing/debugging for web projects. Search for tool prefix `mcp__claude-in-chrome__`

## Report

Present results as a table:

```
## xorio dependency check

| Dependency | Type | Status | Used by |
|---|---|---|---|
| pr-review-toolkit | plugin | OK/MISSING | polish, review |
| ralph-wiggum | plugin | OK/MISSING | polish --auto |
| security-guidance | plugin | OK/MISSING | polish, review, cleanup-code |
| feature-dev | plugin | OK/MISSING (optional) | build workflow |
| frontend-design | plugin | OK/MISSING (optional) | build workflow |
| superpowers | plugin | OK/MISSING (optional) | polish, review (code-reviewer) |
| commit-commands | plugin | OK/MISSING (optional) | git workflows |
| claude-md-management | plugin | OK/MISSING (optional) | polish, review (CLAUDE.md updates) |
| rust-analyzer-lsp | plugin | OK/MISSING (optional) | Rust projects |
| context7 | MCP | OK/MISSING | cleanup-code, tests |
| ast-grep | MCP | OK/MISSING | cleanup-code, analysis |
| serena | MCP | OK/MISSING | cleanup-code, analysis |
| memory | MCP | OK/MISSING (optional) | cross-session knowledge |
| claude-in-chrome | MCP | OK/MISSING (optional) | web project testing |
```

## Install Instructions for Missing Dependencies

For any missing dependency, provide the install command:

**Plugins** — search and install from the Claude Code plugin registry:
- `pr-review-toolkit` — search: "pr-review-toolkit"
- `ralph-wiggum` — search: "ralph-wiggum"
- `security-guidance` — search: "security-guidance"
- `feature-dev` — search: "feature-dev"
- `frontend-design` — search: "frontend-design"
- `superpowers` — search: "superpowers"
- `commit-commands` — search: "commit-commands"
- `claude-md-management` — search: "claude-md-management"
- `rust-analyzer-lsp` — search: "rust-analyzer-lsp" (install for Rust projects)

**MCP servers** — configure in project `.mcp.json` or `~/.claude/.mcp.json`:

context7 and serena are installed as Claude Code plugins with bundled MCP servers. Search the plugin registry for them.

ast-grep:
```json
{
  "mcpServers": {
    "ast-grep": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-ast-grep"]
    }
  }
}
```

memory:
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

claude-in-chrome: Install the "Claude in Chrome" browser extension from the Chrome Web Store, then configure the MCP connection per the extension's setup instructions.

If all dependencies are present, report "All xorio dependencies are installed."
