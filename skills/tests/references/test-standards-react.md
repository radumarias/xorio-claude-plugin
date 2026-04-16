# React Test Standards

## Test Organization

Place tests alongside components:

```
src/
├── components/
│   ├── Button.tsx
│   ├── Button.test.tsx
│   ├── UserList.tsx
│   └── UserList.test.tsx
├── hooks/
│   ├── useAuth.ts
│   └── useAuth.test.ts
```

## React Testing Library

### Component Rendering

```typescript
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders with label text', () => {
    render(<Button label="Submit" />);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = jest.fn();
    const { user } = render(<Button label="Click" onClick={onClick} />);

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when loading', () => {
    render(<Button label="Submit" loading />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

### Query Priority

Prefer queries in this order (most accessible first):
1. `getByRole` — buttons, links, headings
2. `getByLabelText` — form inputs
3. `getByPlaceholderText` — inputs without labels
4. `getByText` — non-interactive elements
5. `getByTestId` — last resort

### User Events

```typescript
import userEvent from '@testing-library/user-event';

it('updates input value on type', async () => {
  const user = userEvent.setup();
  render(<SearchInput />);

  const input = screen.getByRole('textbox');
  await user.type(input, 'search term');
  expect(input).toHaveValue('search term');
});
```

## Hook Testing

```typescript
import { renderHook, act } from '@testing-library/react';
import { useCounter } from './useCounter';

describe('useCounter', () => {
  it('increments count', () => {
    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);
  });
});
```

## Mocking API Calls

### With MSW (preferred)

```typescript
import { rest } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  rest.get('/api/users', (req, res, ctx) => {
    return res(ctx.json([{ id: 1, name: 'Alice' }]));
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('displays users from API', async () => {
  render(<UserList />);
  expect(await screen.findByText('Alice')).toBeInTheDocument();
});
```

### Error states

```typescript
it('shows error message on API failure', async () => {
  server.use(
    rest.get('/api/users', (req, res, ctx) => {
      return res(ctx.status(500));
    })
  );

  render(<UserList />);
  expect(await screen.findByText(/error/i)).toBeInTheDocument();
});
```

## Async Patterns

```typescript
import { waitFor } from '@testing-library/react';

it('loads data and renders list', async () => {
  render(<DataList />);

  await waitFor(() => {
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});
```

## Accessibility Assertions

```typescript
it('has no accessibility violations', async () => {
  const { container } = render(<Form />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## What to Focus On

1. **User interactions** — clicks, typing, form submission
2. **Conditional rendering** — loading, error, empty, populated states
3. **Accessibility** — roles, labels, keyboard navigation
4. **Async data flows** — loading → success/error transitions
5. **Edge cases** — empty data, long text, missing props

## What to Skip

- Internal component state (test behavior, not state)
- Styling/CSS (use visual regression tools if needed)
- Third-party component internals
- React rendering details (virtual DOM, reconciliation)
