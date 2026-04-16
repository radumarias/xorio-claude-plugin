# Vue.js Test Standards

## Test Organization

Place tests alongside components or in a `__tests__/` directory:

```
src/
├── components/
│   ├── UserCard.vue
│   ├── UserCard.test.ts
│   └── __tests__/
│       └── UserCard.test.ts   # alternative location
├── composables/
│   ├── useAuth.ts
│   └── useAuth.test.ts
├── stores/
│   ├── userStore.ts
│   └── userStore.test.ts
```

## Vue Test Utils

### Component Mounting

```typescript
import { mount, shallowMount } from '@vue/test-utils';
import UserCard from './UserCard.vue';

describe('UserCard', () => {
  it('renders user name', () => {
    const wrapper = mount(UserCard, {
      props: { name: 'Alice', email: 'alice@example.com' },
    });
    expect(wrapper.text()).toContain('Alice');
  });

  it('emits select event on click', async () => {
    const wrapper = mount(UserCard, {
      props: { name: 'Alice', email: 'alice@example.com' },
    });

    await wrapper.find('[data-testid="select-btn"]').trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(1);
    expect(wrapper.emitted('select')![0]).toEqual(['Alice']);
  });
});
```

### `mount` vs `shallowMount`

- `mount` — full rendering, child components included. Use for integration tests.
- `shallowMount` — stubs child components. Use for isolated unit tests.

### Props and Slots

```typescript
it('renders slot content', () => {
  const wrapper = mount(Card, {
    slots: {
      default: '<p>Card content</p>',
      header: '<h2>Title</h2>',
    },
  });
  expect(wrapper.find('h2').text()).toBe('Title');
  expect(wrapper.find('p').text()).toBe('Card content');
});
```

## Testing Composition API

```typescript
import { ref } from 'vue';
import { useCounter } from './useCounter';

describe('useCounter', () => {
  it('increments count', () => {
    const { count, increment } = useCounter();
    expect(count.value).toBe(0);

    increment();
    expect(count.value).toBe(1);
  });

  it('resets to initial value', () => {
    const { count, increment, reset } = useCounter(5);
    increment();
    expect(count.value).toBe(6);

    reset();
    expect(count.value).toBe(5);
  });
});
```

## Pinia Store Testing

```typescript
import { setActivePinia, createPinia } from 'pinia';
import { useUserStore } from './userStore';

describe('userStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts with empty user list', () => {
    const store = useUserStore();
    expect(store.users).toEqual([]);
  });

  it('adds user to list', () => {
    const store = useUserStore();
    store.addUser({ id: 1, name: 'Alice' });
    expect(store.users).toHaveLength(1);
  });

  it('computes active user count', () => {
    const store = useUserStore();
    store.addUser({ id: 1, name: 'Alice', active: true });
    store.addUser({ id: 2, name: 'Bob', active: false });
    expect(store.activeCount).toBe(1);
  });
});
```

## Vue Router Testing

```typescript
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import App from './App.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
  ],
});

it('navigates to about page', async () => {
  const wrapper = mount(App, {
    global: { plugins: [router] },
  });

  await router.push('/about');
  await router.isReady();
  expect(wrapper.text()).toContain('About');
});
```

## Async Patterns

```typescript
import { flushPromises } from '@vue/test-utils';

it('loads data on mount', async () => {
  const wrapper = mount(UserList);
  await flushPromises();

  expect(wrapper.findAll('[data-testid="user-item"]')).toHaveLength(3);
});
```

## Validation Commands

```bash
npx vitest run                # run all tests
npx vitest run --watch        # watch mode
npx vue-tsc --noEmit          # type check
```

## What to Focus On

1. **Props and emits** — component contract (inputs/outputs)
2. **User interactions** — click, input, form submission
3. **Computed properties** — derived state correctness
4. **Store actions and getters** — state management logic
5. **Composable return values** — hook behavior in isolation

## What to Skip

- Template structure details (test behavior, not markup)
- Transition/animation implementation
- Vue internal lifecycle timing
- Third-party component rendering
