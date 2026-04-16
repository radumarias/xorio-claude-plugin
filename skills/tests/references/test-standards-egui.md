# egui Test Standards

## Test Factory Pattern

Use the project's `ChatApp::new_test()` factory for creating test instances:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_toggle_sidebar_updates_state() {
        let mut app = ChatApp::new_test();
        assert!(!app.chat_collapsed);

        app.chat_collapsed = true;
        assert!(app.chat_collapsed);
    }
}
```

## Testing State Transitions

Test state changes without rendering. Directly mutate fields and verify:

```rust
#[test]
fn test_select_conversation_updates_id() {
    let mut app = ChatApp::new_test();
    assert!(app.selected_conversation_id.is_none());

    app.selected_conversation_id = Some("conv-123".to_string());
    assert_eq!(app.selected_conversation_id.as_deref(), Some("conv-123"));
}
```

## Testing Channel-Based Message Flows

Create channels, send messages, verify receipt in the drain loop pattern:

```rust
#[test]
fn test_error_channel_creates_toast() {
    let mut app = ChatApp::new_test();
    let err_tx = app.err_tx.clone();

    err_tx.send("Something failed".to_string()).expect("send should succeed");

    // Simulate the drain loop from main_content.rs
    while let Ok(msg) = app.err_rx.try_recv() {
        app.toasts.push(Toast {
            message: msg,
            kind: ToastKind::Error,
            created_at: 0.0,
            duration: 4.0,
        });
    }

    assert_eq!(app.toasts.len(), 1);
    assert_eq!(app.toasts[0].message, "Something failed");
    assert!(matches!(app.toasts[0].kind, ToastKind::Error));
}
```

## Testing Collection Operations

```rust
#[test]
fn test_pending_files_push_and_clear() {
    let mut app = ChatApp::new_test();
    app.pending_files.push("file1.txt".to_string());
    app.pending_files.push("file2.txt".to_string());
    assert_eq!(app.pending_files.len(), 2);

    app.pending_files.clear();
    assert!(app.pending_files.is_empty());
}
```

## Testing Toast Creation

```rust
#[test]
fn test_toast_creation_with_correct_fields() {
    let toast = Toast {
        message: "Upload complete".to_string(),
        kind: ToastKind::Success,
        created_at: 1.0,
        duration: 3.0,
    };

    assert_eq!(toast.message, "Upload complete");
    assert!(matches!(toast.kind, ToastKind::Success));
    assert_eq!(toast.duration, 3.0);
}
```

## Testing Platform-Conditional Code

Use `#[cfg(target_arch = "wasm32")]` guards in tests that depend on platform:

```rust
#[cfg(target_arch = "wasm32")]
#[test]
fn test_wasm_specific_behavior() {
    // Only runs in WASM target
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn test_native_specific_behavior() {
    // Only runs in native target
}
```

For logic that differs by platform, prefer extracting the platform-independent logic into a testable function.

## Testing Enum Dispatch

```rust
#[test]
fn test_rendering_mode_default_is_auto() {
    let mode = RenderingMode::Auto;
    assert!(matches!(mode, RenderingMode::Auto));
}

#[test]
fn test_slash_command_definition_has_description() {
    for cmd in SlashCommandKind::ALL {
        let def = cmd.definition();
        assert!(!def.description.is_empty(), "{:?} missing description", cmd);
    }
}
```

## What NOT to Test in egui

- Don't test egui rendering output (pixel-level) — test state instead
- Don't test `ui.label()` or `ui.button()` calls directly — test the state they modify
- Don't test egui's own layout behavior — trust the framework
- Don't test `eframe::App::update()` directly — test the methods it calls

## What to Focus On

1. **State transitions** — all field mutations that drive UI
2. **Channel flows** — send → drain → state update
3. **Business logic** — calculations, filtering, sorting
4. **Enum completeness** — all variants handled, all definitions present
5. **Error propagation** — error channels produce correct toasts
