# Impact Analysis Guide

---

## Overview

Impact analysis identifies which parts of a system may be affected by a code change. This guides regression testing scope and helps identify high-risk areas.

---

## 1. Dependency Analysis

### Concept
Map explicit dependencies between components/modules to understand what changes when a module is modified.

### How to Conduct

#### 1.1 Direct Dependencies
Identify modules/components that directly depend on the changed code.

```
Changed Component: PaymentService

Direct Dependents:
  ├── OrderProcessor (imports PaymentService)
  ├── CheckoutController (uses PaymentService)
  └── InvoiceGenerator (uses PaymentService)
```

#### 1.2 Transitive Dependencies
Trace dependencies multiple levels deep.

```
PaymentService (changed)
  ↓ imports
OrderProcessor
  ↓ imports
CheckoutController
  ↓ imports
OrderAPI
```

### Tools and Techniques

**Static Analysis Tools**:
- Java: Maven Dependency Tree, Gradle dependencies
- Python: pipdeptree, safety
- Node.js: npm ls, yarn why
- Go: go mod graph

**IDE Features**:
- Find all references/usages
- Call hierarchy viewer
- Dependency diagrams

### Impact Assessment Matrix

| Component | Changed | Direct Dependency | Transitive Dependency | Test Priority |
|-----------|---------|------------------|----------------------|---------------|
| PaymentService | ✓ | - | - | Critical |
| OrderProcessor | | ✓ | - | Critical |
| CheckoutController | | ✓ | - | High |
| InvoiceGenerator | | ✓ | - | High |
| OrderAPI | | | ✓ | Medium |

---

## 2. Call Graph Traversal

### Concept
Create a visual representation of function/method call relationships to trace execution paths through the system.

### How to Conduct

#### 2.1 Create Call Graph
Document which functions call which functions, showing the flow of execution.

```
user_login()
  ├── validate_credentials()
  │   ├── hash_password()
  │   └── compare_hashes()
  ├── create_session()
  │   ├── generate_token()
  │   └── store_session()
  ├── log_user_activity()
  │   └── database.insert()
  └── send_notification()
      ├── get_email_template()
      └── email_service.send()
```

#### 2.2 Identify Changed Function
Mark the function that was modified.

```
user_login()
  ├── validate_credentials() [MODIFIED]
  │   ├── hash_password()
  │   └── compare_hashes()
  └── ... (rest of call graph)
```

#### 2.3 Trace Downstream Impact
Identify all functions that could be affected by the change.

```
Impact Chain:
  validate_credentials() [MODIFIED]
    ↓ called by
  user_login()
    ↓ called by
  AuthenticationController.login()
    ↓ called by
  HTTP POST /api/login
```

### Testing Implications

For each affected function, ensure:
- Direct unit tests of the modified function
- Integration tests of the function with its callers
- End-to-end tests of the complete call chain

---

## 3. Data Flow Analysis

### Concept
Track how data flows through the system to identify which operations may be affected by data structure or processing changes.

### How to Conduct

#### 3.1 Identify Data Touched by Change
Document what data is read, written, or transformed by the changed code.

```
Change: Modified User.email field validation

Data Flow:
  User Input
    ↓ validate_email()  [MODIFIED]
    ↓ process()
    ↓ User.email (stored)
    ↓ send_notifications()
    ↓ third-party API
```

#### 3.2 Trace Data Dependencies
Follow the data to see where it's used downstream.

```
User.email is used by:
  ├── send_notifications()
  ├── generate_reports()
  ├── export_csv()
  ├── audit_log()
  └── third_party_sync()
```

#### 3.3 Backward Tracing
Identify where this data is sourced from.

```
User.email comes from:
  ├── User registration form
  ├── User profile update API
  ├── CSV import
  └── LDAP sync
```

### Sensitive Data Flows

Pay special attention to:
- Personally identifiable information (PII)
- Financial/payment data
- Authentication credentials
- Audit trails

### Testing Strategy

For each data flow path:
1. Test valid data transformations
2. Test boundary and edge cases
3. Test data integrity end-to-end
4. Verify audit trails and logging
5. Check third-party integrations

---

## 4. Integration Point Mapping

### Concept
Identify where the system interacts with external systems or services, as changes may affect these critical touchpoints.

### How to Conduct

#### 4.1 Document Integration Points

```
System: Order Management

Integration Points:
  1. Payment Gateway Integration
     - Endpoint: POST /api/payments/charge
     - Data: Payment info, customer ID
     - Synchronous/Asynchronous: Sync
     - Frequency: On order checkout

  2. Inventory Service Integration
     - Endpoint: GET /inventory/stock/{itemId}
     - Data: Item ID
     - Synchronous/Asynchronous: Sync
     - Frequency: Real-time

  3. Email Service (SendGrid)
     - Endpoint: POST /send
     - Data: Email template, variables
     - Synchronous/Asynchronous: Async
     - Frequency: Per order milestone

  4. Analytics Pipeline
     - Endpoint: Kafka topic: order-events
     - Data: Order event JSON
     - Synchronous/Asynchronous: Async (fire-and-forget)
     - Frequency: Per order

  5. Tax Service API
     - Endpoint: GET /calculate-tax
     - Data: Order total, location
     - Synchronous/Asynchronous: Sync
     - Frequency: During checkout
```

#### 4.2 Assess Change Impact on Integrations

For each integration point, determine:
- Does the change affect the request format?
- Does the change affect the response handling?
- Does the change affect error handling?
- Does the change affect timing/order of operations?

#### 4.3 Create Integration Test Matrix

| Integration Point | Change Impact | Contract Broken? | Needs Re-testing |
|------------------|---------------|-----------------|-----------------|
| Payment Gateway | Request payload changed | Maybe | Yes |
| Inventory Service | No change | No | No |
| Email Service | Template variables changed | Yes | Yes |
| Analytics | Event structure changed | Yes | Yes |
| Tax Service | No change | No | No |

### Integration Testing Checklist

For each affected integration:
- [ ] Verify request format matches API contract
- [ ] Verify response parsing still works
- [ ] Test error scenarios (timeout, 4xx, 5xx)
- [ ] Test with mocked external service
- [ ] Test with contract testing if available
- [ ] Verify data transformations before/after integration
- [ ] Test request retry logic if applicable
- [ ] Verify logging and monitoring still works
- [ ] Test fallback behavior
- [ ] Validate end-to-end transaction flow

---

## Impact Analysis Workflow

### Step 1: Change Analysis
1. Identify what code was changed
2. Understand the reason for the change
3. Identify the intended behavior change

### Step 2: Dependency Mapping
1. Run dependency analysis tools
2. Create list of directly affected components
3. Identify transitive dependencies

### Step 3: Call Graph Analysis
1. Identify all functions that call changed code
2. Trace impact upward to entry points
3. Document complete call chains

### Step 4: Data Flow Analysis
1. Identify data read/written by changed code
2. Trace data usage downstream
3. Identify backward data sources

### Step 5: Integration Point Review
1. List all external integrations
2. Determine if any are affected
3. Update integration tests

### Step 6: Risk Prioritization
1. Mark high-risk areas (critical business logic, integrations)
2. Mark medium-risk areas (frequently used components)
3. Mark low-risk areas (isolated utility functions)

### Step 7: Test Scope Definition
Create regression test plan:
- Unit tests for changed code
- Integration tests for all affected components
- Contract tests for affected integrations
- End-to-end tests for critical workflows

---

## Tools for Impact Analysis

### Static Analysis
- **SonarQube**: Code quality and dependency analysis
- **Understand (Science Toolkit)**: Call graph and dependency visualization
- **Lattix**: Architecture and dependency analysis
- **Dep Check**: Dependency vulnerability analysis

### Language-Specific
- **Java**: IDE refactoring tools, Maven plugins
- **Python**: pydeps, importlib analysis
- **JavaScript**: Webpack bundle analysis, import graph tools
- **Go**: go mod graph, gotemplate

### Version Control
- **Git**: `git diff` to identify changed files
- **GitHub**: Insights > Dependency graph
- **GitLab**: Dependency Scanning

### Test Management
- Document impact findings in test plan
- Map test cases to impacted components
- Track regression test coverage per component

---

## Example: Complete Impact Analysis

**Scenario**: Modified authentication token expiration from 1 hour to 30 minutes

### Dependency Analysis
- AuthenticationService (changed)
  - TokenValidator (direct)
  - SessionManager (direct)
  - UserController (transitive)
  - APIGateway (transitive)

### Call Graph
```
validate_token()  [MODIFIED - timeout check]
  ↑ called by
TokenValidator.isValid()
  ↑ called by
AuthMiddleware.authenticate()
  ↑ called by
Every API endpoint
```

### Data Flow
- User token (JWT)
  - Created in login()
  - Stored in browser localStorage
  - Sent with every request
  - Validated in AuthMiddleware
  - Expires after 30 minutes (changed from 60)

### Integration Points
- Frontend: Token refresh logic may need adjustment
- Mobile: Token storage and refresh handling
- Third-party: Any apps using our tokens

### Test Plan
1. Unit: Test new 30-minute expiration calculation
2. Integration: Test token refresh flow with AuthMiddleware
3. E2E: Test user session spanning token expiration
4. E2E: Test token refresh doesn't lose user data
5. E2E: Test concurrent requests during token refresh
6. API Contract: Verify token endpoint response format unchanged
7. Frontend: Verify token refresh behavior works correctly
