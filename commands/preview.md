---
description: Preview a Markdown or Mermaid file in a side panel; no path opens a file picker (needs the doc-preview mod)
argument-hint: "[path]"
disable-model-invocation: true
allowed-tools: []
---

# /xorio:preview

When the **doc-preview** mod is installed it answers this command itself (it hooks `command.run` for `xorio:preview`), so this text never reaches you. If you are reading it, the mod is not loaded in this session.

Do not try to preview `$ARGUMENTS` yourself. Tell the user, briefly:

- `/xorio:preview` is provided by the **doc-preview** mod, which ships in the xorio marketplace but installs separately.
- Install it with `/plugin install doc-preview@xorio` (after `/plugin marketplace add radumarias/xorio-claude-plugin` if the marketplace isn't added yet), or, from a checkout, start Claude Code with `--plugin-dir <repo>/mods/doc-preview`.
- Then run `/xorio:preview $ARGUMENTS` again.
