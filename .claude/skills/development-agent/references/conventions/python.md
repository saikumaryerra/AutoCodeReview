# Python Coding Conventions

## Naming Conventions
- **Classes**: `PascalCase` (e.g., `UserManager`, `APIClient`)
- **Functions/Methods**: `snake_case` (e.g., `get_user`, `calculate_total`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`, `API_TIMEOUT`)
- **Variables**: `snake_case` (e.g., `user_count`, `is_active`)
- **Private**: Prefix with underscore (e.g., `_private_method`)
- **Dunder**: Use sparingly (e.g., `__init__`, `__str__`)
- **Module names**: `lowercase` or `snake_case` (e.g., `user_manager.py`)
- **Avoid**: Single letter variables (except in comprehensions/loops), ambiguous names

## Imports
- Sort in three groups: stdlib, third-party, local
- One import per line (except `from x import a, b, c`)
- Use absolute imports, not relative
- Avoid wildcard imports (`from module import *`)
- Group related imports together
- Example:
  ```python
  import json
  from pathlib import Path

  import requests
  from flask import Flask, jsonify

  from app.models import User
  from app.utils import format_date
  ```

## Type Hints
- Use type hints for all function arguments and return values
- Use `Optional[T]` for nullable types, not `T | None` (for Python <3.10)
- Use `Union` for multiple types, `TypeVar` for generics
- Use `Protocol` for structural typing
- Example:
  ```python
  from typing import Optional, List, Dict

  def process_users(users: List[Dict[str, str]]) -> Optional[str]:
      pass
  ```
- For complex types, use type aliases
- Enable mypy or similar type checker in CI/CD

## Docstrings
- Use triple-quoted strings for all modules, functions, classes
- Follow Google or NumPy style consistently
- Include: brief description, arguments, return value, exceptions
- Example (Google style):
  ```python
  def fetch_user(user_id: int) -> Dict[str, Any]:
      """Fetch user data from database.

      Args:
          user_id: The ID of the user to fetch.

      Returns:
          A dictionary containing user information.

      Raises:
          UserNotFoundError: If user doesn't exist.
      """
  ```

## Error Handling
- Use specific exception types, not bare `except:`
- Create custom exceptions for domain-specific errors
- Use context managers for resource cleanup (`with` statements)
- Log exceptions with full context
- Example:
  ```python
  try:
      result = database.get_user(user_id)
  except DatabaseError as e:
      logger.error(f"Failed to fetch user {user_id}", exc_info=True)
      raise UserNotFoundError(f"User {user_id} not found") from e
  ```

## Project Structure
```
project/
├── src/
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── models/
│       │   ├── __init__.py
│       │   └── user.py
│       ├── services/
│       │   ├── __init__.py
│       │   └── user_service.py
│       └── utils/
│           ├── __init__.py
│           └── helpers.py
├── tests/
│   ├── __init__.py
│   ├── test_models.py
│   └── test_services.py
├── requirements.txt
├── pyproject.toml
├── README.md
└── .gitignore
```

## Code Style
- Follow PEP 8 guidelines
- Max line length: 88 characters (Black formatter default)
- Use Black for code formatting
- Use flake8 or pylint for linting
- Use pytest for testing
- Use virtual environments (venv, poetry, pipenv)
- Enable pre-commit hooks for formatting/linting

## Best Practices
- Avoid mutable default arguments: `def func(items=None):` not `def func(items=[]):`
- Use `f-strings` for formatting, not `%` or `.format()`
- Use comprehensions for simple iterations
- Prefer composition over inheritance
- Use `dataclasses` or `pydantic` for data structures
- Keep functions small and focused (single responsibility)
- Document non-obvious behavior or complex algorithms
- Use assertions for internal consistency checks, not for validation
- Avoid global state; pass dependencies as arguments
