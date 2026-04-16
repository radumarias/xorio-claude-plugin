# TypeScript Test Standards

## Test Organization

Place test files alongside source files with `.test.ts` or `.test.tsx` suffix:

```
src/
├── utils.ts
├── utils.test.ts
├── components/
│   ├── Button.tsx
│   └── Button.test.tsx
```

For integration tests, use a `__tests__/` directory or `tests/` at the package root.

## Naming Convention

Use `describe`/`it` blocks with readable descriptions:

```typescript
describe('parseInput', () => {
  it('returns parsed object for valid JSON', () => {
    const result = parseInput('{"name": "test"}');
    expect(result).toEqual({ name: 'test' });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseInput('{')).toThrow();
  });
});
```

Name pattern: `<action> <scenario>` — reads as a sentence with `it`.

## Framework: Jest / Vitest

```typescript
// Assertions
expect(value).toBe(exact);           // strict equality
expect(value).toEqual(deep);         // deep equality
expect(value).toBeTruthy();          // truthy check
expect(value).toBeNull();            // null check
expect(array).toContain(item);       // array inclusion
expect(fn).toThrow(/pattern/);       // error assertion
expect(fn).toHaveBeenCalledWith(a);  // mock call check
```

## Mocking Patterns

### Module mocks

```typescript
jest.mock('./api', () => ({
  fetchData: jest.fn().mockResolvedValue({ id: 1 }),
}));
```

### Function mocks

```typescript
const handler = jest.fn();
handler.mockReturnValue(42);
handler.mockImplementation((x: number) => x * 2);
handler.mockResolvedValue('async result');
```

### Spy on existing methods

```typescript
const spy = jest.spyOn(console, 'error').mockImplementation();
// ... test code ...
expect(spy).toHaveBeenCalledWith('expected error');
spy.mockRestore();
```

## Async Test Patterns

```typescript
it('fetches and returns data', async () => {
  const data = await fetchData('key');
  expect(data).toEqual({ id: 1 });
});

it('rejects on network error', async () => {
  await expect(fetchData('bad')).rejects.toThrow('Network error');
});
```

## Test Setup/Teardown

```typescript
describe('Database', () => {
  let db: TestDB;

  beforeEach(() => {
    db = new TestDB();
  });

  afterEach(() => {
    db.cleanup();
  });

  it('stores and retrieves values', () => {
    db.set('key', 'value');
    expect(db.get('key')).toBe('value');
  });
});
```

## Validation Commands

```bash
npm test                    # run all tests
npm test -- --watch         # watch mode
npx tsc --noEmit            # type check without emitting
npx vitest run              # Vitest single run
```

## Common Pitfalls

- **Don't forget to await async assertions** — `expect(fn()).rejects.toThrow()` without `await` silently passes
- **Don't mock too broadly** — mock at the boundary, not every internal function
- **Clean up mocks** — use `jest.restoreAllMocks()` in `afterEach` or `vi.restoreAllMocks()`
- **Don't test implementation details** — test behavior and outputs, not internal state
- **Avoid snapshot overuse** — snapshots are fragile; prefer explicit assertions for logic
- **Type your test data** — use `as const` or explicit types to catch test data bugs at compile time

## What to Test

Focus on:
1. **Exported functions** — public API of each module
2. **Error handling** — try/catch paths, error boundaries, rejected promises
3. **Edge cases** — empty arrays, undefined, null, empty strings
4. **Type guards and validators** — ensure they correctly narrow types

Skip:
- Type-only exports (interfaces, type aliases)
- Re-exports that add no logic
- Framework boilerplate (e.g., `createApp()` calls with no custom config)
