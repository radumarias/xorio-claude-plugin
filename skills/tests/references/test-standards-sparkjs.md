# SparkJS Test Standards

## Test Organization

Place tests alongside source files:

```
src/
├── components/
│   ├── SceneComponent.ts
│   └── SceneComponent.test.ts
├── signals/
│   ├── dataSignals.ts
│   └── dataSignals.test.ts
```

## Testing Reactive Data Bindings

```typescript
describe('DataBinding', () => {
  it('updates bound value when signal changes', () => {
    const signal = createSignal(0);
    let observed = signal.get();

    signal.set(42);
    observed = signal.get();

    expect(observed).toBe(42);
  });

  it('triggers subscribers on change', () => {
    const signal = createSignal('initial');
    const callback = jest.fn();

    signal.subscribe(callback);
    signal.set('updated');

    expect(callback).toHaveBeenCalledWith('updated');
  });

  it('does not trigger on same value', () => {
    const signal = createSignal('stable');
    const callback = jest.fn();

    signal.subscribe(callback);
    signal.set('stable');

    expect(callback).not.toHaveBeenCalled();
  });
});
```

## Mocking SparkJS Runtime APIs

```typescript
// Mock the SparkJS runtime
const mockRuntime = {
  scene: {
    root: { children: [] },
    find: jest.fn(),
    traverse: jest.fn(),
  },
  time: {
    deltaTime: 0.016,
    elapsed: 0,
  },
  input: {
    getPointerPosition: jest.fn().mockReturnValue({ x: 0, y: 0 }),
  },
};

describe('SceneComponent', () => {
  it('initializes with runtime context', () => {
    const component = new SceneComponent(mockRuntime);
    expect(component.isInitialized).toBe(true);
  });
});
```

## Testing Signal/Patch Behavior

```typescript
describe('PatchSystem', () => {
  it('applies patch to state', () => {
    const state = createState({ count: 0, label: 'test' });

    applyPatch(state, { count: 5 });

    expect(state.get().count).toBe(5);
    expect(state.get().label).toBe('test'); // unchanged
  });

  it('batches multiple patches', () => {
    const state = createState({ a: 1, b: 2 });
    const updates: number[] = [];
    state.subscribe(() => updates.push(state.get().a));

    batch(() => {
      applyPatch(state, { a: 10 });
      applyPatch(state, { a: 20 });
    });

    // Should only trigger once with final value
    expect(updates).toEqual([20]);
  });
});
```

## Testing Scene Composition

```typescript
describe('SceneComposition', () => {
  it('composes parent-child hierarchy', () => {
    const parent = createNode('parent');
    const child = createNode('child');

    parent.addChild(child);

    expect(parent.children).toContain(child);
    expect(child.parent).toBe(parent);
  });

  it('removes child from scene', () => {
    const parent = createNode('parent');
    const child = createNode('child');
    parent.addChild(child);

    parent.removeChild(child);

    expect(parent.children).not.toContain(child);
    expect(child.parent).toBeNull();
  });

  it('traverses composition tree', () => {
    const root = createNode('root');
    const a = createNode('a');
    const b = createNode('b');
    root.addChild(a);
    a.addChild(b);

    const names: string[] = [];
    root.traverse((node) => names.push(node.name));

    expect(names).toEqual(['root', 'a', 'b']);
  });
});
```

## Integration Tests

```typescript
describe('SparkJS App Integration', () => {
  it('initializes app and renders first frame', async () => {
    const app = createApp({
      scene: mockScene,
      runtime: mockRuntime,
    });

    await app.init();
    app.tick(0.016);

    expect(app.isRunning).toBe(true);
    expect(mockRuntime.scene.root.children.length).toBeGreaterThan(0);
  });
});
```

## What to Focus On

1. **Signal reactivity** — subscriptions, updates, batching
2. **Patch application** — partial state updates, merge behavior
3. **Scene composition** — hierarchy operations, traversal
4. **Component lifecycle** — init, update, destroy
5. **Data bindings** — signal → UI data flow

## What to Skip

- Visual rendering output
- Platform-specific runtime internals
- Third-party SparkJS plugin behavior
- Animation frame timing precision
