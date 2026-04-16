# xorio-claude-plugin

A Claude Code plugin for test generation — analyzes coverage gaps, detects anti-patterns, and generates idiomatic tests.

## What It Does

- **Analyzes** your codebase for missing tests, untested error paths, and edge cases
- **Detects anti-patterns** in existing tests (mock misuse, fragile tests, incomplete test doubles)
- **Generates** idiomatic unit and integration tests following your project's conventions
- **Reviews** documentation for test infrastructure gaps

Supports: Rust, TypeScript, Python, and frameworks like egui, React, Vue.js, Three.js, Docker, AWS.

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| `tests` | Command | Slash command with scoped arguments (`/xorio:tests`) |
| `tests` | Skill | Auto-triggers on test-related intent |
| `test-analyzer` | Agent | Identifies coverage gaps and anti-patterns |
| `test-generator` | Agent | Writes tests with mock quality gates and an 8-point checklist |
| `test-docs-advisor` | Agent | Reviews docs for undocumented test infrastructure |

## Installation

### Local (for development)

```bash
# Clone the repo
git clone git@github.com:radumarias/xorio-claude-plugin.git

# Point Claude Code at it
claude --plugin-dir /path/to/xorio-claude-plugin
```

Or add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "plugins": [
    "/path/to/xorio-claude-plugin"
  ]
}
```

### For a specific project

Add to your project's `.claude/settings.json`:

```json
{
  "plugins": [
    "/path/to/xorio-claude-plugin"
  ]
}
```

## Usage

### `/xorio:tests` — the main command

```
/xorio:tests                    # test local changes (git diff)
/xorio:tests src/auth           # test a specific module/directory
/xorio:tests --project          # scan the full project
/xorio:tests src/auth --no-docs # module scope, skip doc review
/xorio:tests --project --no-docs
```

**What it does:**
1. Detects languages and frameworks from files in scope
2. Loads matching test standards (Rust, TS, Python, egui, React, etc.)
3. Analyzes coverage gaps and anti-patterns in existing tests
4. Reviews documentation for test infrastructure gaps (unless `--no-docs`)
5. Asks which gaps to fill
6. Generates tests following your project's conventions
7. Runs validation (cargo test, npm test, pytest, etc.)

### `tests` skill (auto-trigger)

The `tests` skill auto-activates when Claude detects test-related intent in conversation. It runs the same workflow as `/xorio:tests` using diff scope.

## Evolving the Plugin

Edit the files directly and restart your Claude Code session to pick up changes:

- **Add a test standard**: create `skills/tests/test-standards-{name}.md` and add detection logic in `SKILL.md`
- **Tune agent behavior**: edit `agents/test-analyzer.md` or `agents/test-generator.md`
- **Add anti-pattern checks**: extend Step 3.5 in `agents/test-analyzer.md`

## Sharing with Colleagues

Since this is a Git repo, colleagues can:

```bash
git clone git@github.com:radumarias/xorio-claude-plugin.git
claude --plugin-dir /path/to/xorio-claude-plugin
```

Or add it directly from GitHub in their settings.

## License

MIT
