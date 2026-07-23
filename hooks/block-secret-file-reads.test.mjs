#!/usr/bin/env node
// Test suite for hooks/block-secret-file-reads.mjs (the PreToolUse Bash|Read
// secret-file guard).
//
// Run (from repo root):
//   node --test
// or explicitly:
//   node --test hooks/block-secret-file-reads.test.mjs
// Requires Node >= 18. Stdlib only — no dependencies, no package.json needed.
//
// Black-box subprocess harness: the guard has no exports and runs its logic
// at module top level with side effects (stdin read, process.exit), so it is
// spawned as a real subprocess — exactly how hooks.json invokes it — rather
// than imported. The guard exits 0 on BOTH deny and allow (block-secret-file-
// reads.mjs:63,123), so decisions here are always read from stdout content,
// never from the exit code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "block-secret-file-reads.mjs");

function runGuardRaw(rawStdin) {
  const res = spawnSync(process.execPath, [GUARD], { input: rawStdin, encoding: "utf8" });
  assert.equal(res.status, 0, "guard must always exit 0 (deny and allow both exit 0)");
  const out = res.stdout.trim();
  if (!out) return { decision: "allow" };
  const parsed = JSON.parse(out);
  return {
    decision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

function runGuard(tool_input) {
  return runGuardRaw(JSON.stringify({ hook_event_name: "PreToolUse", tool_input }));
}

function assertAllow(tool_input) {
  assert.deepEqual(runGuard(tool_input), { decision: "allow" });
}

// The deny reason's boilerplate sentence always mentions ".env" and ".secrets"
// regardless of which rule fired, so a bare `reason.includes(label)` check is
// vacuous for those two labels. Anchoring on "(label:" targets the per-match
// parenthetical instead, so the assertion actually proves the right rule fired.
function assertDeny(tool_input, expectedLabel) {
  const { decision, reason } = runGuard(tool_input);
  assert.equal(decision, "deny");
  if (expectedLabel) {
    assert.ok(
      reason.includes(`(${expectedLabel}:`),
      `expected reason to name rule "${expectedLabel}", got: ${reason}`,
    );
  }
}

test("bare .env (Bash) denies", () => {
  assertDeny({ command: "cat .env" }, ".env");
});

test("bare .env (Read) denies", () => {
  assertDeny({ file_path: ".env" });
});

test(".env.local / .env.production (Read) denies", () => {
  assertDeny({ file_path: "/app/.env.local" });
});

test(".secrets (Read) denies", () => {
  assertDeny({ file_path: ".secrets" }, ".secrets");
});

test("id_rsa (Read) denies", () => {
  assertDeny({ file_path: "/home/u/.ssh/id_rsa" }, "private key");
});

test("id_rsa (Bash) denies", () => {
  assertDeny({ command: "cat ~/.ssh/id_rsa" });
});

test("id_ed25519 (Read) denies", () => {
  assertDeny({ file_path: "/home/u/.ssh/id_ed25519" });
});

test("key/cert .key (Bash) denies", () => {
  assertDeny({ command: "openssl rsa -in server.key" }, "key/cert file");
});

test("key/cert .pem (Read) denies", () => {
  assertDeny({ file_path: "certs/tls.pem" });
});

test("key/cert .p12 (Read) denies", () => {
  assertDeny({ file_path: "keystore/app.p12" });
});

test("credentials .pgpass (Read) denies", () => {
  assertDeny({ file_path: ".pgpass" }, "credentials file");
});

test("credentials bare (Read) denies", () => {
  assertDeny({ file_path: "aws/credentials" });
});

test("credentials .netrc (Read) denies", () => {
  assertDeny({ file_path: "/home/u/.netrc" });
});

test(".env.example (Read) allows", () => {
  assertAllow({ file_path: ".env.example" });
});

test(".env.example (Bash) allows", () => {
  assertAllow({ command: "cat .env.example" });
});

test("config/.env.example (Read) allows", () => {
  assertAllow({ file_path: "config/.env.example" });
});

test(".secrets.example (Read) allows", () => {
  assertAllow({ file_path: ".secrets.example" });
});

test("normal .ts file (Read) allows", () => {
  assertAllow({ file_path: "src/index.ts" });
});

test("normal .md file (Read) allows", () => {
  assertAllow({ file_path: "README.md" });
});

test("quoted mention in commit message (Bash) allows", () => {
  assertAllow({ command: 'git commit -m "update .env docs"' });
});

test("quoted mention in echo (Bash) allows", () => {
  assertAllow({ command: 'echo "see .env"' });
});

test("plain benign command (Bash) allows", () => {
  assertAllow({ command: "ls -la src/" });
});

test("command takes precedence over file_path", () => {
  assertAllow({ command: "ls", file_path: ".env" });
});

test("malformed stdin allows (fail-open)", () => {
  assert.deepEqual(runGuardRaw("not json"), { decision: "allow" });
});

test("empty tool_input allows", () => {
  assert.deepEqual(runGuardRaw("{}"), { decision: "allow" });
});
