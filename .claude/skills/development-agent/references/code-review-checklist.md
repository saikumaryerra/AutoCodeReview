# Code Review Checklist

## Correctness
- [ ] Logic is correct and handles all cases properly
- [ ] Variables are used correctly and initialized before use
- [ ] Edge cases and boundary conditions are handled
- [ ] Null/undefined values are properly checked
- [ ] Loop conditions and iteration logic are correct
- [ ] Recursive functions have proper base cases
- [ ] Off-by-one errors are avoided
- [ ] State management is correct

## Security
- [ ] No hardcoded secrets, passwords, or API keys
- [ ] Input validation is performed on all user inputs
- [ ] SQL injection risks are mitigated (use parameterized queries)
- [ ] XSS vulnerabilities are prevented (proper escaping/encoding)
- [ ] CSRF tokens are used where appropriate
- [ ] Authentication checks are in place
- [ ] Authorization checks are enforced
- [ ] Sensitive data is not logged
- [ ] No insecure deserialization
- [ ] Dependencies are up-to-date and secure

## Performance
- [ ] No obvious performance bottlenecks
- [ ] Database queries are optimized (no N+1 queries)
- [ ] Unnecessary loops or iterations are avoided
- [ ] Memory leaks are not introduced
- [ ] Caching is used appropriately
- [ ] Async/await is used correctly for I/O operations
- [ ] No blocking operations in async contexts
- [ ] Algorithm complexity is reasonable for the use case

## Error Handling
- [ ] All exceptions are properly caught and handled
- [ ] Error messages are helpful and don't expose sensitive information
- [ ] Errors are logged appropriately
- [ ] Graceful degradation occurs on errors
- [ ] Resource cleanup happens on error (try/finally, context managers)
- [ ] Specific exceptions are caught, not blanket catches
- [ ] Error recovery is attempted where applicable

## Readability
- [ ] Variable and function names are clear and descriptive
- [ ] Comments explain "why", not "what"
- [ ] Code is DRY (Don't Repeat Yourself)
- [ ] Functions are focused and have single responsibility
- [ ] Function length is reasonable (not too long)
- [ ] Complexity is manageable (avoid deep nesting)
- [ ] Code formatting is consistent
- [ ] No dead code or commented-out code

## Testing
- [ ] Unit tests are included for new/modified code
- [ ] Tests cover happy path and error cases
- [ ] Tests are independent and don't rely on execution order
- [ ] Test names clearly describe what they test
- [ ] Mock objects are used appropriately
- [ ] Test coverage is adequate (aim for >80%)
- [ ] Integration tests are added for multi-component changes
- [ ] No skipped or disabled tests without clear reason

## Documentation
- [ ] Function/class docstrings are present and accurate
- [ ] Complex logic is documented with comments
- [ ] README or contributing guide is updated if needed
- [ ] API documentation is updated if applicable
- [ ] Type hints/signatures are present and correct
- [ ] Breaking changes are documented
- [ ] Examples or usage patterns are provided where helpful

## Architecture
- [ ] Changes follow established patterns in the codebase
- [ ] No circular dependencies introduced
- [ ] Separation of concerns is maintained
- [ ] Dependencies are minimal and justified
- [ ] No tight coupling to external systems
- [ ] Configuration is externalized appropriately
- [ ] Changes don't violate SOLID principles
- [ ] No deprecated APIs are used
