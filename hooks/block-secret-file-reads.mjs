#!/usr/bin/env node
// PreToolUse(Bash|Read|Grep) guard: block reads of secret / private-data files.
//
// This is the plugin-shipped copy of the maintainer's personal ~/.claude guard.
// On a personal machine the *tool* vector (the Read tool) is covered
// declaratively by `permissions.deny` in settings.json — but a plugin CANNOT
// ship permission rules (a plugin's settings.json only honors `agent` /
// `subagentStatusLine`; a `permissions` key is silently ignored). So, to give
// plugin consumers the same protection, this one hook covers all three
// content-reading vectors via a `"Bash|Read|Grep"` matcher in hooks.json:
//   - Bash — shell commands that read secrets: `cat .env`, `source .env`,
//     `grep X .env.production`, `openssl rsa -in server.key`
//     (inspects `tool_input.command`).
//   - Read — the Read tool pointed at a protected file
//     (inspects `tool_input.file_path`).
//   - Grep — the Grep tool with `output_mode: "content"` returns matching file
//     *lines*, so a Grep aimed at a protected file leaks it just like a Read.
//     Inspects the path-like fields `tool_input.path` and `tool_input.glob`
//     (never `pattern`, a search regex — grepping the tree for the literal
//     text ".env" is legitimate and must stay allowed).
// Placeholder templates (`*.example`) stay allowed so Claude can still learn
// what config exists.
//
// Contract: reads the PreToolUse event JSON on stdin, picks the command string
// (Bash), file path (Read), or path/glob (Grep) out of `tool_input`, and prints
// a PreToolUse "deny" decision when it references a protected file. Anything
// else → exit silently (allow).
//
// Quoted strings in a Bash command are stripped before matching, so commands
// that merely *mention* a secret filename in a message (e.g.
// `git commit -m "... .env ..."`, `echo "see .env"`) are allowed — only bare
// file arguments are inspected. A Read `file_path` has no shell quoting and is
// matched as-is.
//
// Caveat: matching is by filename, so on the Read vector a *source* file that
// happens to be named like a secret (e.g. `credentials.ts`, `foo.key`) is also
// denied. This mirrors the Bash behavior and is intentional consistency, not a
// bug — narrow RULES below if a consumer needs such names readable.
//
// Limitations: for Bash this only sees the literal command string, with quoted
// segments stripped. An indirect read (a script that internally sources .env)
// or a deliberately quoted filename (`cat ".env"`) is not caught. Defense-in-
// depth, not a sandbox.
//
// Runtime: Node (on PATH), stdlib only.

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // If stdin never opens, don't hang forever.
    setTimeout(() => resolve(data), 2000).unref?.();
  });
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// Each rule: a regex matched against the command, plus a short label.
// `.example` templates are explicitly excluded via negative lookahead/checks.
const RULES = [
  // .env and .env.<anything> EXCEPT .env.example / .env.*.example
  {
    label: ".env",
    re: /(?<![\w-])\.env(?:\.(?!example(?:[^\w.-]|$))[\w-]+)*(?![\w.-])/i,
  },
  // .secrets and .secrets.<anything> EXCEPT .secrets.example
  {
    label: ".secrets",
    re: /(?<![\w-])\.secrets(?:\.(?!example(?:[^\w.-]|$))[\w-]+)*(?![\w.-])/i,
  },
  // Private-key / cert / keystore file extensions
  { label: "key/cert file", re: /(?<![\w])[\w./-]+\.(?:pem|key|pfx|p12)(?![\w])/i },
  // Well-known private key names
  { label: "private key", re: /(?<![\w-])id_(?:rsa|dsa|ecdsa|ed25519)(?![\w])/i },
  // Credential / auth files
  { label: "credentials file", re: /(?<![\w-])(?:credentials|\.pgpass|\.netrc)(?![\w])/i },
];

const evt = await readStdin().then((raw) => {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
});
const toolName = typeof evt?.tool_name === "string" ? evt.tool_name : "";
const toolInput = evt?.tool_input ?? {};

// Bash → scan the command string; Read → scan the file path; Grep → scan the
// path-like fields. Whichever the event carries.
let scan = "";
if (typeof toolInput.command === "string") {
  // Remove single- and double-quoted segments so quoted text (commit messages,
  // echo strings, docs) doesn't trip the matcher — only bare file args remain.
  scan = toolInput.command.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");
} else if (typeof toolInput.file_path === "string") {
  // A Read file_path is a single literal path — no shell quoting to strip.
  scan = toolInput.file_path;
} else if (toolName === "Grep") {
  // Grep with output_mode "content" returns file *contents*, so a Grep pointed
  // at a protected file (`path`) or filtered onto one (`glob`) would leak it
  // straight past the Bash/Read guard. Inspect only these path-like fields —
  // never `pattern`, which is the search regex.
  scan = [toolInput.path, toolInput.glob]
    .filter((v) => typeof v === "string")
    .join(" ");
}

if (scan) {
  for (const rule of RULES) {
    const m = scan.match(rule.re);
    if (m) {
      deny(
        `Blocked: this would read a secret / private-data file (${rule.label}: "${m[0]}"). ` +
          `Reading .env, .secrets, keys, or credentials is not allowed — read the *.example ` +
          `template, use a 'just' target, or ask the user for the value instead.`,
      );
    }
  }
}

// Allow: print nothing and exit 0.
process.exit(0);
