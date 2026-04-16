# Rust Test Standards

## Test Organization

### Inline Unit Tests
Place unit tests in the same file using a `#[cfg(test)]` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_input_valid_json_returns_struct() {
        let input = r#"{"name": "test"}"#;
        let result = parse_input(input).expect("valid JSON should parse");
        assert_eq!(result.name, "test");
    }
}
```

### Integration Tests
Place in `tests/` directory at the crate root. Each file is compiled as a separate crate:

```
my_crate/
├── src/
│   └── lib.rs
└── tests/
    ├── api_integration.rs
    └── common/
        └── mod.rs       # shared test helpers
```

## Naming Convention

`test_<function>_<scenario>_<expected>`

Examples:
- `test_parse_input_empty_string_returns_error`
- `test_cache_evict_at_capacity_removes_oldest`
- `test_send_message_disconnected_queues_retry`

## Test Attributes

```rust
#[test]                                    // sync test
#[tokio::test]                             // async test
#[should_panic(expected = "out of range")] // panic assertion
#[ignore]                                  // skip unless --ignored
```

## Assertion Patterns

```rust
assert_eq!(actual, expected);              // equality
assert_ne!(actual, unexpected);            // inequality
assert!(condition);                        // boolean
assert!(result.is_ok());                   // Result success
assert!(result.is_err());                  // Result failure
assert!(matches!(value, Pattern::Variant)); // pattern match

// Custom message on failure
assert_eq!(len, 3, "expected 3 items but got {len}");
```

## Mocking Patterns

### Trait-based mocking
Define a trait for the dependency, implement a mock:

```rust
trait Storage {
    fn get(&self, key: &str) -> Option<String>;
}

struct MockStorage {
    data: HashMap<String, String>,
}

impl Storage for MockStorage {
    fn get(&self, key: &str) -> Option<String> {
        self.data.get(key).cloned()
    }
}
```

### Builder pattern for test data

```rust
struct TestUserBuilder {
    name: String,
    email: String,
}

impl TestUserBuilder {
    fn new() -> Self {
        Self {
            name: "test_user".into(),
            email: "test@example.com".into(),
        }
    }

    fn name(mut self, name: &str) -> Self {
        self.name = name.into();
        self
    }

    fn build(self) -> User {
        User { name: self.name, email: self.email }
    }
}
```

## Async Test Patterns

```rust
#[tokio::test]
async fn test_fetch_data_returns_cached_value() {
    let cache = TestCache::with_entry("key", "value");
    let result = fetch_data(&cache, "key").await;
    assert_eq!(result.expect("should return cached"), "value");
}
```

## Validation Commands

Run these after generating tests:
```bash
cargo test                              # run all tests
cargo test -p <crate>                   # run tests for specific crate
cargo test <test_name>                  # run single test
cargo clippy --all-targets --all-features  # lint including test code
cargo fmt --check                       # formatting check
```

## Common Pitfalls

- **Don't use `.unwrap()` in test setup** — use `.expect("context")` so failures are debuggable
- **Don't test private functions directly** — test through the public API unless the function is complex enough to warrant `pub(crate)` visibility for testing
- **Don't hardcode thread-dependent behavior** — use channels or `tokio::sync` for coordination
- **Avoid `#[ignore]` without a comment** — always explain why a test is ignored
- **Don't leak test state** — each test must be independent; use fresh instances, not shared mutable state
- **Avoid `sleep()` in tests** — use channels, barriers, or `tokio::time::pause()` for timing-dependent tests

## What to Test

Focus on:
1. **Business logic** — core algorithms, state transitions, calculations
2. **Error paths** — invalid inputs, missing data, network failures
3. **Boundary conditions** — empty collections, zero values, max capacity
4. **Edge cases** — Unicode, very long strings, concurrent access

Skip:
- Trivial getters/setters with no logic
- Direct wrappers that just forward to another function
- Auto-generated code (derive macros, schema.rs)
