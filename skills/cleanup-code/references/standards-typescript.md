# TypeScript Implementation Standards

Use these whenever you need to work with TypeScript code.

## Error Handling

**Use typed errors** instead of throwing generic `Error`. Define error types or use discriminated unions for predictable error flows.

```typescript
// Bad - generic error
throw new Error("Failed to fetch user");

// Good - typed result
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```

**Always handle Promise rejections.** Use try/catch with async/await. Never leave `.catch()` empty.

```typescript
// Bad
fetchData().catch(() => {});

// Good
try {
  await fetchData();
} catch (error) {
  logger.error("Failed to fetch data", { error });
  throw error;
}
```

## Code Organization

**Maximum 1000 lines per file.** Split by concern into separate modules.

**Prefer named exports** over default exports for better refactoring and IDE support.

```typescript
// Prefer
export function parseConfig(raw: string): Config { ... }

// Avoid
export default function parseConfig(raw: string): Config { ... }
```

**Group related functionality** into barrel files (`index.ts`) but avoid deep re-export chains.

**Co-locate tests** alongside source as `*.test.ts`.

## Type Design

**Prefer interfaces for object shapes**, use type aliases for unions and intersections.

```typescript
// Object shape → interface
interface User {
  id: string;
  email: string;
}

// Union → type
type Result = Success | Failure;
```

**Avoid `any`**. Use `unknown` when the type is genuinely unknown, then narrow with type guards.

**Prefer `readonly`** for properties that shouldn't be mutated after construction.

## Code Quality

**Run these checks before considering implementation complete:**

```bash
npx biome check --write .    # Formatting + linting
npx tsc --noEmit             # Type checking
npm test                     # All tests pass
```

**Key lint rules to respect:**
- No unused variables or imports
- No implicit `any`
- Consistent return types on public functions
- Prefer `const` over `let` when the value isn't reassigned

## Naming Conventions

Follow TypeScript conventions:

- `camelCase` for functions, methods, variables, parameters
- `PascalCase` for types, interfaces, classes, enums
- `SCREAMING_SNAKE_CASE` for constants
- Prefix interfaces with `I` only if the project already does; otherwise don't
- Boolean variables: use `is`, `has`, `should` prefixes (`isLoading`, `hasError`)
