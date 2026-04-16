# Rust Implementation Standards

Use these whenever you need to work with Rust code.

## Error Handling

Proper error handling is crucial for maintainable Rust code.

**Use `.expect()` with descriptive messages** instead of `.unwrap()`. The message should explain what operation failed and provide context for debugging.

```rust
// ❌ Bad - no context on failure
let config = File::open("config.toml").unwrap();

// ✅ Good - clear failure context
let config = File::open("config.toml")
    .expect("Failed to open config.toml - ensure the file exists in the project root");
```

**Prefer `?` operator with custom error types** for recoverable errors in library code. Reserve `.expect()` for cases where failure is truly unrecoverable.

## Code Organization

**Maximum 1000 lines per file.** When a file exceeds this limit, split it logically by concern. Consider extracting into submodules.

```rust
// Instead of one large module.rs, split into:
mod module/
├── mod.rs          // Re-exports and shared types
├── parsing.rs      // Parsing logic
├── validation.rs   // Validation logic
└── transforms.rs   // Transformation logic
```

**Prefer refactoring existing methods** over creating new duplicative ones. Use IDE tooling to identify candidates for consolidation.

**Group related functionality** using modules and keep public API surface minimal. Hide implementation details with `pub(crate)` or `pub(super)` when full public visibility isn't needed.

## API Usage

**Never use deprecated APIs.** Check documentation for recommended alternatives. Use `#[allow(deprecated)]` only temporarily during migrations, with a TODO comment explaining the timeline.

**Verify library versions and API compatibility** using context7 or official documentation before implementation. APIs change between major versions; don't assume stability.

## Code Quality

**Run these checks before considering implementation complete:**

```bash
cargo fmt          # Consistent formatting
cargo clippy       # Lint checks
cargo test         # All tests pass
cargo doc          # Documentation builds cleanly
```

**Clippy lints to pay attention to:**

- `clippy::unwrap_used` - Prefer `.expect()` or error handling
- `clippy::large_enum_variant` - Consider boxing large variants
- `clippy::cognitive_complexity` - Split complex functions

## Diagnostics

The **rust-analyzer-lsp** plugin provides compile-time diagnostics (errors and warnings) on `.rs` files transparently. No explicit invocation is needed — diagnostics surface automatically when editing Rust code.

## Naming Conventions

Follow Rust conventions strictly:

- `snake_case` for functions, methods, variables, modules
- `CamelCase` for types and traits
- `SCREAMING_SNAKE_CASE` for constants and statics
- Prefix unused variables with `_`
