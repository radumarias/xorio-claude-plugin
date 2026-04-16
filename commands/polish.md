---
description: "Polish local changes — simplify, clean up, review, and audit before PR"
argument-hint: "[--auto] [--max-iterations N]"
---

# Polish Command

Parse `$ARGUMENTS`:

## No flags → Interactive Mode

Use the Skill tool to invoke the `xorio:polish` skill. It runs the full polish pipeline interactively (Steps 1-7: scope check, simplify, cleanup, review, security audit, validation, summary).

## `--auto` → Auto Mode

Use the Skill tool to invoke `ralph-wiggum:ralph-loop` with the following prompt:

```
Run the xorio:polish skill workflow on local changes. Fix all findings. --completion-promise 'All polish checks pass clean' --max-iterations N
```

Where N comes from `--max-iterations` (default 3). Then stop — ralph handles the rest.

## `--max-iterations N`

Only valid with `--auto`. Sets the ralph-loop iteration limit (default: 3). Pass it through to the ralph-loop invocation above.
