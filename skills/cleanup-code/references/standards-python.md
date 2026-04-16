# Python Implementation Standards

Use these whenever you need to work with Python code.

## Error Handling

**Use specific exception types** instead of bare `except`. Never silently swallow exceptions.

```python
# Bad - catches everything silently
try:
    process(data)
except:
    pass

# Good - specific exception with context
try:
    process(data)
except ValueError as e:
    logger.error("Invalid data format: %s", e)
    raise
```

**Define custom exceptions** for domain-specific errors. Inherit from appropriate built-in exceptions.

```python
class ConfigurationError(RuntimeError):
    """Raised when configuration is invalid or missing."""
```

**Use `contextlib.suppress`** only for truly ignorable exceptions, never for broad categories.

## Code Organization

**Maximum 1000 lines per file.** Split by concern into submodules with `__init__.py` re-exports.

```
module/
├── __init__.py      # Re-exports public API
├── parsing.py       # Parsing logic
├── validation.py    # Validation logic
└── transforms.py    # Transformation logic
```

**Prefer functions over classes** when there's no state to manage. Don't create classes just for namespace grouping.

**Use type hints** on all public function signatures. Use `from __future__ import annotations` for forward references.

## Type Hints

**Annotate all public APIs.** Internal helpers can skip hints if the types are obvious.

```python
def fetch_user(user_id: str) -> User | None:
    ...
```

**Use `collections.abc` types** for generic parameters (`Sequence`, `Mapping`, `Iterable`) instead of concrete types (`list`, `dict`).

**Use `TypeAlias`** for complex types:

```python
from typing import TypeAlias

UserMap: TypeAlias = dict[str, User]
```

## Code Quality

**Run these checks before considering implementation complete:**

```bash
ruff check --fix .    # Linting with auto-fix
ruff format .         # Formatting
mypy .                # Type checking
pytest                # All tests pass
```

**Key lint rules to respect:**
- No unused imports or variables
- No bare `except` clauses
- No mutable default arguments
- Use f-strings over `.format()` or `%` formatting
- Prefer `pathlib.Path` over `os.path`

## Naming Conventions

Follow PEP 8 strictly:

- `snake_case` for functions, methods, variables, modules
- `PascalCase` for classes and type aliases
- `SCREAMING_SNAKE_CASE` for constants
- `_prefix` for private/internal names
- Avoid single-letter names except for loop counters (`i`, `j`) and lambda arguments
