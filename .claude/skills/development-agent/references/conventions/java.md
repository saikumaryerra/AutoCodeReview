# Java Coding Conventions

## Naming Conventions
- **Classes**: `PascalCase` (e.g., `UserManager`, `APIClient`)
- **Interfaces**: `PascalCase` (e.g., `UserRepository`, `DataService`)
- **Methods**: `camelCase` (e.g., `getUser`, `calculateTotal`)
- **Variables**: `camelCase` (e.g., `userName`, `isActive`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`, `API_TIMEOUT`)
- **Package**: `lowercase.reverse.domain` (e.g., `com.example.users.service`)
- **Avoid**: Single letter variables (except loop counters), ambiguous names

## Package Structure
```
com/
└── example/
    ├── users/
    │   ├── User.java
    │   ├── UserManager.java
    │   └── dto/
    │       └── UserDTO.java
    ├── services/
    │   └── UserService.java
    ├── repositories/
    │   ├── UserRepository.java
    │   └── JpaUserRepository.java
    ├── exceptions/
    │   └── UserNotFoundException.java
    └── utils/
        └── StringUtils.java
```

## Exception Handling
- Create custom exceptions for domain-specific errors
- Extend appropriate base class (`RuntimeException` or `Exception`)
- Always include meaningful error messages
- Include root cause when rethrowing (`throw new CustomException(message, cause)`)
- Example:
  ```java
  public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(String userId) {
      super("User not found: " + userId);
    }

    public UserNotFoundException(String userId, Throwable cause) {
      super("User not found: " + userId, cause);
    }
  }

  try {
    User user = userRepository.findById(userId);
  } catch (DataAccessException e) {
    throw new UserNotFoundException(userId, e);
  }
  ```
- Use specific exception types, not bare `catch (Exception e)`
- Log exceptions with full context
- Clean up resources in `finally` blocks or use try-with-resources

## Generics
- Use type parameters for reusable classes and methods
- Use wildcards appropriately (bounded and unbounded)
- Avoid raw types
- Example:
  ```java
  public class Repository<T> {
    public Optional<T> findById(Long id) {
      // implementation
    }
  }

  // Usage
  Repository<User> userRepository = new UserRepository();
  Optional<User> user = userRepository.findById(1L);
  ```
- Use bounded wildcards for flexibility:
  ```java
  public <T extends Entity> void save(T entity) {
    // implementation
  }

  public <T> List<T> findAll(Class<? extends T> clazz) {
    // implementation
  }
  ```

## Design Patterns
- **Dependency Injection**: Use constructor injection over field injection
  ```java
  public UserService(UserRepository repository) {
    this.repository = repository;
  }
  ```
- **Builder Pattern**: Use for complex objects with many fields
  ```java
  User user = new User.Builder()
    .id(1L)
    .name("John Doe")
    .email("john@example.com")
    .build();
  ```
- **Immutability**: Prefer immutable objects for data transfer
  ```java
  public final class User {
    private final Long id;
    private final String name;
  }
  ```
- **Repository Pattern**: Abstract data access logic
- **Singleton**: Use enum-based singletons (thread-safe by default)
  ```java
  public enum Config {
    INSTANCE;
    // implementation
  }
  ```

## Code Style
- Follow Google Java Style Guide or internal conventions
- Use checkstyle or similar linting tools
- Max line length: 120 characters
- Use 4 spaces for indentation
- Use `final` for variables that won't be reassigned
- Use `@Override` annotation consistently
- Use `@Deprecated` with Javadoc for deprecated code
- Maintain consistent blank line spacing

## Documentation
- Write Javadoc for all public classes, methods, and fields
- Include `@param`, `@return`, `@throws` tags
- Document non-obvious behavior or complex algorithms
- Example:
  ```java
  /**
   * Fetches a user by their unique identifier.
   *
   * @param userId the unique identifier of the user
   * @return an Optional containing the user if found
   * @throws DataAccessException if database access fails
   */
  public Optional<User> findById(Long userId) {
    // implementation
  }
  ```

## Best Practices
- Avoid null; use `Optional<T>` for nullable values
- Use enhanced for loops over index-based iteration
- Use streams for collection operations when appropriate
- Keep methods small and focused (single responsibility)
- Prefer composition over inheritance
- Use interfaces for contracts, abstract classes for shared implementation
- Validate inputs at method entry points
- Use checked exceptions for recoverable errors, runtime exceptions for bugs
- Avoid hardcoding magic numbers; define named constants
- Use enums for fixed sets of values
- Prefer JDK Collections over third-party when possible
- Use immutable collections for defensive copying
