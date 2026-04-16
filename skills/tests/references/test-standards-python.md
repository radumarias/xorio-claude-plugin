# Python Test Standards

## Test Organization

Place tests in a `tests/` directory mirroring the source structure, or alongside source files:

```
# Preferred: separate tests directory
src/
├── mypackage/
│   ├── __init__.py
│   ├── parser.py
│   └── validator.py
tests/
├── conftest.py
├── test_parser.py
└── test_validator.py

# Alternative: tests alongside source
src/
├── parser.py
├── test_parser.py
```

## Naming Convention

Prefix test functions and files with `test_`:

```python
def test_parse_input_valid_json_returns_dict():
    result = parse_input('{"name": "test"}')
    assert result == {"name": "test"}


def test_parse_input_empty_string_raises_value_error():
    with pytest.raises(ValueError, match="empty input"):
        parse_input("")
```

Pattern: `test_<function>_<scenario>_<expected>`

## Framework: pytest

### Assertions

```python
assert value == expected                    # equality
assert value != unexpected                  # inequality
assert value is None                        # identity
assert isinstance(value, MyClass)           # type check
assert "substring" in text                  # containment
assert len(items) == 3                      # collection size

# Exception assertions
with pytest.raises(ValueError, match="invalid"):
    risky_function()

# Approximate float comparison
assert value == pytest.approx(3.14, abs=0.01)
```

### Parametrize

```python
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("", ""),
    ("123", "123"),
])
def test_uppercase_transforms_correctly(input, expected):
    assert uppercase(input) == expected
```

## Fixture Patterns

```python
# conftest.py — shared fixtures
import pytest


@pytest.fixture
def sample_user():
    return User(name="test", email="test@example.com")


@pytest.fixture
def db_session():
    session = create_test_session()
    yield session
    session.rollback()
    session.close()


# Fixture with factory pattern
@pytest.fixture
def make_user():
    def _make(name="test", email="test@example.com"):
        return User(name=name, email=email)
    return _make
```

## Mocking with pytest-mock

```python
def test_fetch_data_calls_api(mocker):
    mock_get = mocker.patch("mypackage.client.requests.get")
    mock_get.return_value.json.return_value = {"id": 1}

    result = fetch_data("key")

    mock_get.assert_called_once_with("https://api.example.com/key")
    assert result == {"id": 1}
```

## Async Test Patterns

```python
import pytest


@pytest.mark.asyncio
async def test_async_fetch_returns_data():
    result = await async_fetch("key")
    assert result == {"id": 1}
```

## Validation Commands

```bash
pytest                        # run all tests
pytest tests/test_parser.py   # run specific file
pytest -k "test_parse"        # run tests matching pattern
pytest --tb=short             # shorter tracebacks
mypy src/                     # type checking
ruff check src/               # linting
```

## Common Pitfalls

- **Don't use `assert` in `except` blocks without re-raising** — pytest can't report the original error
- **Don't share mutable state between tests** — use fixtures with proper scope
- **Don't mock builtins broadly** — mock at the import site (`mocker.patch("mymodule.open")`)
- **Avoid `time.sleep()` in tests** — use `freezegun` or mock the clock
- **Don't use bare `except`** — always specify the exception type in `pytest.raises`
- **Clean up temp files** — use `tmp_path` fixture instead of manual file creation

## What to Test

Focus on:
1. **Business logic** — data transformations, calculations, state machines
2. **Error paths** — invalid inputs, missing keys, API failures
3. **Boundary conditions** — empty collections, None values, edge indices
4. **Data validation** — schema validation, type coercion, serialization

Skip:
- `__init__.py` files with only imports
- Simple dataclass definitions with no methods
- CLI entry points (test the underlying functions instead)
