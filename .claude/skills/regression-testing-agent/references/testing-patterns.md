# Testing Patterns Reference

---

## 1. Testing Pyramid

The Testing Pyramid illustrates the ideal distribution of tests across different levels of granularity and cost.

```
         /\
        /  \
       / E2E \
      /       \
     /---------\
    /           \
   / Integration \
  /               \
 /-----------------\
/                   \
/  Unit Tests        \
/                     \
-----------------------
```

### Structure

| Level | Description | Count | Speed | Cost | Maintainability |
|-------|-------------|-------|-------|------|-----------------|
| **Unit** | Test individual functions/methods in isolation | Many (60-70%) | Very Fast | Low | High |
| **Integration** | Test multiple components working together | Moderate (20-30%) | Medium | Medium | Medium |
| **End-to-End (E2E)** | Test complete user workflows | Few (10-15%) | Slow | High | Low |

### Best Practices
- Write lots of fast, focused unit tests
- Use integration tests for critical workflows
- Keep E2E tests for key user journeys only
- Use mocks/stubs in unit tests to isolate components
- Avoid having too many E2E tests (pyramid inversion anti-pattern)

---

## 2. Test Doubles

Test doubles are substitutes for real objects used to isolate the code under test.

### 2.1 Mocks
Objects with pre-programmed behavior and expectations. Verify interactions by asserting that methods were called.

**Use when**: Testing interactions between components; verifying that a function calls another function correctly.

```javascript
// Example: Mocking a logger
const mockLogger = {
  log: jest.fn(),
  error: jest.fn()
};

serviceUnderTest.doSomething(mockLogger);
expect(mockLogger.log).toHaveBeenCalledWith('Done');
```

### 2.2 Stubs
Objects that return pre-configured responses without enforcing expectations.

**Use when**: You need a dependency to return specific values; you don't care about call verification.

```javascript
// Example: Stubbing a database call
const stubDatabase = {
  getUser: () => ({ id: 1, name: 'John' })
};

const result = userService.fetchUser(stubDatabase);
expect(result.name).toBe('John');
```

### 2.3 Fakes
Working implementations with simplified logic, useful for testing without external dependencies.

**Use when**: You need realistic behavior but without external service dependencies.

```javascript
// Example: In-memory database fake
class FakeDatabase {
  constructor() {
    this.data = {};
  }

  save(key, value) {
    this.data[key] = value;
  }

  get(key) {
    return this.data[key];
  }
}
```

### 2.4 Spies
Partial mocks that track interactions on real objects.

**Use when**: You want to monitor real code behavior without replacing it entirely.

```javascript
// Example: Spying on a real function
const spy = jest.spyOn(console, 'log');
functionThatLogs();
expect(spy).toHaveBeenCalled();
spy.mockRestore();
```

---

## 3. Arrange-Act-Assert (AAA) Pattern

Standardized structure for unit tests with three clear phases.

### Pattern Structure

```
ARRANGE - Set up test data and preconditions
ACT     - Execute the code being tested
ASSERT  - Verify the results
```

### Example

```python
def test_calculate_discount():
    # ARRANGE
    original_price = 100
    discount_percent = 10

    # ACT
    discounted_price = calculate_discount(original_price, discount_percent)

    # ASSERT
    assert discounted_price == 90
```

### Benefits
- Clear test structure and readability
- Easy to identify test setup, execution, and verification
- Simplifies test maintenance and debugging
- Works across all programming languages

---

## 4. Given-When-Then (BDD Style)

Behavior-Driven Development approach emphasizing business-readable test specifications.

### Pattern Structure

```
GIVEN  - Initial state/context (preconditions)
WHEN   - Action that triggers behavior
THEN   - Expected outcome
```

### Example

```gherkin
Scenario: User logs in with valid credentials
  GIVEN the user is on the login page
  AND a user account exists with email "user@example.com"
  WHEN the user enters "user@example.com" as email
  AND the user enters "password123" as password
  AND the user clicks the login button
  THEN the user is logged in
  AND the user is redirected to the dashboard
```

### Code Example

```python
def test_user_login_with_valid_credentials():
    # GIVEN
    user_email = "user@example.com"
    user_password = "password123"
    auth_service = AuthService()
    auth_service.create_user(user_email, user_password)

    # WHEN
    result = auth_service.login(user_email, user_password)

    # THEN
    assert result.is_authenticated == True
    assert result.user_email == user_email
```

### Advantages
- Bridges gap between business and technical teams
- Tests document expected behavior clearly
- Easier to identify missing test scenarios
- Supports Behavior-Driven Development frameworks (Cucumber, Behave, etc.)

---

## 5. Property-Based Testing

Testing by verifying properties that should hold true for all inputs, not just specific test cases.

### Concept
Rather than testing with hardcoded input-output pairs, generate random inputs and verify invariant properties.

### Example

```python
from hypothesis import given
from hypothesis.strategies import integers

@given(integers())
def test_absolute_value_is_non_negative(x):
    assert abs(x) >= 0

@given(integers(), integers())
def test_addition_is_commutative(a, b):
    assert a + b == b + a
```

### Benefits
- Discovers edge cases and corner cases automatically
- Reduces reliance on manually crafted test data
- Properties often reveal hidden assumptions in code
- Excellent for data transformation and algorithmic testing

### Best Practices
- Identify invariant properties that always hold
- Use shrinking to find minimal failing cases
- Combine with unit tests for critical paths
- Document the property being tested

---

## 6. Snapshot Testing

Capturing and comparing serialized snapshots of output to detect unintended changes.

### Concept
Generate a snapshot of output (JSON, HTML, etc.) and store it. Future test runs compare against the snapshot.

### Example

```javascript
describe('UserComponent', () => {
  it('renders correctly', () => {
    const component = render(<UserProfile user={{ id: 1, name: 'John' }} />);
    expect(component).toMatchSnapshot();
  });
});
```

First run creates snapshot:
```javascript
exports[`UserComponent renders correctly 1`] = `
<div>
  <h1>John</h1>
  <p>ID: 1</p>
</div>
`;
```

### Use Cases
- UI component testing (React, Vue, Angular)
- API response validation
- Configuration file verification
- Report output validation

### Advantages and Cautions
- Quickly detects unintended visual/structural changes
- Easy to implement for complex outputs
- Risk: Developers may approve snapshots without careful review
- Requires version control for snapshot files
- Good for regression testing but not suitable for TDD

---

## 7. Contract Testing

Testing that services conform to agreed contracts/interfaces without coupling to implementations.

### Concept
Define explicit contracts (request/response schemas) between services and verify both sides honor them.

### Example: API Contract

```yaml
Contract: UserAPI
  GET /users/{id}
    Request:
      - Parameter: id (integer, required)
    Response:
      Status: 200
      Body:
        - id: integer
        - name: string
        - email: string
```

### Example Test (Pact Framework)

```javascript
describe('UserService Contract', () => {
  it('returns user data in correct format', () => {
    // Consumer test
    expect(response).toEqual({
      id: expect.any(Number),
      name: expect.any(String),
      email: expect.any(String)
    });
  });
});

describe('UserAPI Provider', () => {
  it('provides user endpoint matching contract', () => {
    // Provider test
    const response = getUserById(1);
    expect(response).toMatchContract('UserAPI.GET./users/{id}');
  });
});
```

### Benefits
- Prevents breaking changes between services
- Enables independent service testing
- Early detection of integration issues
- Supports microservices architecture

### Tools
- Pact (multi-language)
- Spring Cloud Contract
- GraphQL Testing Libraries

---

## Choosing the Right Pattern

| Scenario | Recommended Pattern |
|----------|-------------------|
| Testing a pure function with multiple inputs | Property-Based Testing |
| Testing UI component rendering | Snapshot Testing |
| Testing business logic with clear inputs/outputs | Arrange-Act-Assert |
| Testing microservice integrations | Contract Testing |
| Writing tests from behavior specifications | Given-When-Then |
| Testing a component with dependencies | Mocks/Stubs + AAA |
| Regression testing UI changes | Snapshot Testing |
| Verifying API calls in the right order | Mocks |

---

## Testing Anti-Patterns to Avoid

- **Test Coupling**: Tests dependent on each other or shared state
- **Pyramid Inversion**: More E2E tests than unit tests
- **Mock Overuse**: Mocking so much that tests don't catch real bugs
- **Flaky Tests**: Tests that pass/fail inconsistently
- **Assertion Roulette**: Multiple assertions without clear separation
- **Hard-coded Test Data**: Brittle tests dependent on specific values
