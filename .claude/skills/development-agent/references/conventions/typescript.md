# TypeScript Coding Conventions

## Naming Conventions
- **Classes**: `PascalCase` (e.g., `UserManager`, `APIClient`)
- **Interfaces**: `PascalCase` (e.g., `IUser`, `IUserRepository`)
- **Types**: `PascalCase` (e.g., `UserId`, `UserStatus`)
- **Functions**: `camelCase` (e.g., `getUser`, `calculateTotal`)
- **Variables**: `camelCase` (e.g., `userName`, `isActive`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`, `API_TIMEOUT`)
- **Private**: Use `private` keyword or prefix with `#` (e.g., `private userId`)
- **Enums**: `PascalCase` with `SCREAMING_SNAKE_CASE` members (e.g., `Status.ACTIVE`)

## Types vs Interfaces
- **Types**: Use for primitives, unions, tuples, type aliases
  ```typescript
  type UserId = string | number;
  type Status = 'active' | 'inactive' | 'pending';
  type Coordinates = [number, number];
  ```
- **Interfaces**: Use for object shapes that might be extended
  ```typescript
  interface User {
    id: UserId;
    name: string;
    email: string;
  }

  interface AdminUser extends User {
    role: 'admin';
  }
  ```
- Prefer `interface` for public APIs, `type` for internal logic
- Avoid redundant `I` prefix (e.g., `User` not `IUser`)

## Error Handling
- Create custom error classes extending `Error`
- Use specific error types for different scenarios
- Include context in error messages
- Example:
  ```typescript
  class UserNotFoundError extends Error {
    constructor(userId: string) {
      super(`User with ID ${userId} not found`);
      this.name = 'UserNotFoundError';
    }
  }

  try {
    const user = await userService.getUser(userId);
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      // Handle specific error
    }
    throw error;
  }
  ```

## Async Patterns
- Use `async/await` over `.then()/.catch()`
- Always handle promise rejections
- Use `Promise<T>` type annotations
- Example:
  ```typescript
  async function fetchUsers(): Promise<User[]> {
    try {
      const response = await fetch('/api/users');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Failed to fetch users', error);
      throw error;
    }
  }
  ```
- Use `Promise.all()` for parallel operations
- Use `Promise.allSettled()` when some can fail
- Avoid floating promises; always `await` or `.catch()`

## Module Structure
```
src/
├── index.ts
├── types/
│   ├── user.ts
│   └── api.ts
├── services/
│   ├── index.ts
│   └── UserService.ts
├── controllers/
│   └── UserController.ts
├── utils/
│   └── helpers.ts
└── errors/
    └── AppError.ts
```

## Type Annotations
- Use strict type checking (`strict: true` in tsconfig.json)
- Annotate all function parameters and return types
- Use generics for reusable components
- Example:
  ```typescript
  interface ApiResponse<T> {
    data: T;
    status: number;
  }

  async function fetchData<T>(endpoint: string): Promise<ApiResponse<T>> {
    // implementation
  }
  ```
- Use `unknown` for truly unknown types, not `any`
- Use `never` for impossible states

## Code Style
- Use ESLint with TypeScript plugin
- Use Prettier for consistent formatting
- Max line length: 100 characters
- Use single quotes for strings
- Use semicolons consistently
- Use trailing commas in multi-line structures
- Example:
  ```typescript
  const config = {
    apiUrl: 'https://api.example.com',
    timeout: 5000,
    retries: 3,
  };
  ```

## Best Practices
- Enable strict null checks (`strictNullChecks: true`)
- Use type guards for narrowing types
- Avoid `any` type; use generics or `unknown`
- Use readonly for immutable properties
- Use `const` for variables, avoid `let` and `var`
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Separate business logic from framework code
- Keep functions focused and small
- Document complex types and algorithms
- Use enums sparingly; prefer string literals with unions
- Always return promises, not callbacks (except event handlers)
