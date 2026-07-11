# Requirements Engineering: Patterns and Anti-Patterns

This document outlines common patterns (best practices) and anti-patterns (pitfalls) in requirements engineering with practical examples.

---

## Functional Requirement Patterns

### Good Pattern: Specific and Testable

**Example:**
```
The system SHALL display a confirmation dialog when a user clicks
the "Delete Account" button, showing the account name and requiring
the user to enter their password before deletion is processed.
```

**Why it works:**
- Clear action and trigger ("when user clicks Delete Account")
- Specific behavior ("display confirmation dialog")
- Measurable outcome ("requires password entry")
- Testable condition

---

### Anti-Pattern: Vague Requirements

**Example:**
```
The system SHOULD handle user deletion gracefully.
```

**Why it fails:**
- "Handle gracefully" is not measurable or testable
- No clear trigger or action defined
- Multiple interpretations possible
- Cannot determine when requirement is met

**How to fix it:**
Add specificity about what "gracefully" means:
```
The system SHALL prevent data loss by:
1. Requiring explicit password confirmation
2. Displaying account recovery options for 30 days
3. Notifying user via email at their registered address
4. Providing clear status messages at each step
```

---

### Good Pattern: User-Centric Functional Requirements

**Example:**
```
When a user initiates a file download over a slow connection (< 1 Mbps),
the system SHALL:
- Display a "slow connection" warning with estimated download time
- Offer the option to reduce file quality/resolution
- Enable pause/resume functionality
- Save download progress locally in case of connection loss
```

**Why it works:**
- Addresses real user scenario
- Multiple behaviors specified
- Clear conditions and outcomes
- Testable with specific metrics

---

### Anti-Pattern: Implementation Details in Functional Requirements

**Example:**
```
The system SHALL use Redis caching with a TTL of 5 minutes
to improve performance.
```

**Why it fails:**
- Specifies implementation (Redis) rather than requirement
- Doesn't specify what the functional requirement actually is
- Couples requirement to specific technology
- Limits design flexibility

**How to fix it:**
```
The system SHALL retrieve frequently accessed user profiles
in under 100ms for 95% of requests (P95 latency).
```

---

## Non-Functional Requirement Patterns

### Good Pattern: SMART NFRs

**Example:**
```
NFR-PERF-001: Response Time
The system SHALL return results for user searches within 2 seconds
for 99% of queries containing fewer than 1 million records.
```

**Why it works:**
- Specific metric (2 seconds)
- Measurable percentage (99%)
- Quantified scope (< 1 million records)
- Clear measurement approach

---

### Anti-Pattern: Unmeasurable NFR

**Example:**
```
The system MUST be fast and reliable.
```

**Why it fails:**
- "Fast" and "reliable" are subjective
- No metrics or thresholds
- Cannot measure compliance
- No clear acceptance criteria

**How to fix it:**
```
Performance:
- API response time: P95 < 500ms, P99 < 1s
- Page load time: < 3 seconds on 4G networks
- Database query execution: < 100ms for 99% of queries

Reliability:
- System uptime: 99.95% monthly SLA
- Error rate: < 0.1% of transactions
- MTTR (Mean Time To Repair): < 30 minutes
```

---

### Good Pattern: Qualified Security Requirements

**Example:**
```
All passwords SHALL be:
1. Encrypted using PBKDF2 with at least 100,000 iterations, or bcrypt
2. Never stored in plaintext
3. Transmitted only over TLS 1.2+
4. Enforced with minimum 12 characters, including uppercase,
   lowercase, digit, and special character
```

**Why it works:**
- Specific security controls
- Industry-standard algorithms
- Measurable constraints
- Clear validation approach

---

### Anti-Pattern: Over-Specific NFR

**Example:**
```
The system SHALL use AWS Lambda with Node.js 16.x and MySQL 5.7
with m5.2xlarge instances in us-east-1 for maximum performance.
```

**Why it fails:**
- Constrains technology choices prematurely
- Couples NFR to specific infrastructure
- Difficult to change if requirements shift
- May not be optimal for actual use case

**How to fix it:**
```
The system SHALL:
- Support horizontal scaling to handle 10x peak traffic
- Use cloud-agnostic containerization (Docker)
- Support database failover and replication
- Target deployment cost not exceeding $X per month
```

---

## Scope Patterns

### Good Pattern: Clear In/Out of Scope

**Example:**
```
In Scope:
- User authentication via OAuth 2.0
- Password reset via email verification
- Multi-factor authentication setup

Out of Scope:
- Biometric authentication (Phase 2)
- Third-party identity provider management (Future)
- Single sign-on with legacy systems (Separate project)
```

**Why it works:**
- Crystal clear boundaries
- Prevents scope creep
- Manages stakeholder expectations
- Justifies exclusions

---

### Anti-Pattern: Implicit Scope

**Example:**
```
Build a reporting system that gives users insights into their data.
```

**Why it fails:**
- No clear feature boundaries
- "Insights" is subjective
- Unclear reporting types
- Easy to have scope creep disputes

**How to fix it:**
```
In Scope:
- Pre-built dashboard with 5 key metrics (Revenue, Users, Engagement, Churn, LTV)
- Custom report builder with drag-and-drop interface
- Export to CSV and PDF
- Scheduled email delivery of reports
- Real-time data refresh for last 30 days

Out of Scope:
- Advanced predictive analytics (requires data science team)
- Custom metric calculations beyond template formulas
- Integration with external BI tools like Tableau
```

---

## Acceptance Criteria Patterns

### Good Pattern: Scenario-Based Acceptance Criteria

**Example:**
```
User Story: User wants to reset their password

Acceptance Criteria:

Scenario 1: Successful password reset
Given a user is on the login page
When they click "Forgot Password"
And enter their registered email
And receive the reset link email
And click the link and enter a new password
Then the password is updated immediately
And they see "Password successfully reset"
And they can log in with the new password

Scenario 2: Expired reset link
Given a user clicks a password reset link
When the link is more than 24 hours old
Then they see "Link has expired"
And they're offered to request a new link

Scenario 3: Invalid email
Given a user enters an email not in the system
When they click "Send Reset Link"
Then they see "No account found with that email"
And no reset email is sent (security: no account enumeration)
```

**Why it works:**
- Clear test cases
- Edge cases covered
- Explicit pass/fail conditions
- Security implications considered

---

### Anti-Pattern: Vague Acceptance Criteria

**Example:**
```
The feature works correctly.
All bugs are fixed.
User is satisfied.
```

**Why it fails:**
- No objective test conditions
- "Works correctly" is undefined
- Cannot measure success
- Subjective and arguable

**How to fix it:**
```
Acceptance Criteria:
- [ ] Feature loads within 2 seconds
- [ ] All user inputs are validated with clear error messages
- [ ] Data persists correctly after page refresh
- [ ] Feature works on Chrome, Firefox, Safari (latest 2 versions)
- [ ] No console errors or warnings
- [ ] Accessibility check passes (WCAG 2.1 Level AA)
- [ ] Performance: < 50ms main thread blocking
```

---

## Dependency Patterns

### Good Pattern: Explicit Dependency Management

**Example:**
```
User Story: US-145 - Multi-factor authentication setup

Dependencies:
- Blocks: US-146 (Admin dashboard - requires MFA to be complete)
- Depends On: US-138 (Email verification system - needed for MFA verification)
- External: Twilio SMS API (third-party service)

Risk: If US-138 is delayed, US-145 will be blocked. Plan: Run in parallel
if possible, with mock email service initially.
```

**Why it works:**
- Clear dependency direction
- Blocks and depends-on relationships explicit
- External dependencies identified
- Risk mitigation planned

---

### Anti-Pattern: Hidden Dependencies

**Example:**
```
User Story: US-200 - Payment processing
[No dependencies listed]

Team discovers during development:
- Requires PCI compliance (NFR)
- Depends on payment gateway integration (missed dependency)
- Blocks three other features
- Regulatory review required (timeline not planned)
```

**Why it fails:**
- Delays discovered during implementation
- Timeline estimates invalid
- Surprises derail sprint planning
- Quality suffers from time pressure

---

## User Story Patterns

### Good Pattern: Complete User Story

**Example:**
```
User Story: US-087

Title: Save search filters for quick reuse

As a data analyst
I want to save my current search filter combinations
So that I can quickly re-run common analyses without rebuilding filters each time

Acceptance Criteria:
Given I've set up a complex filter (3+ criteria)
When I click "Save Filter"
And enter a name (e.g., "Q4 Revenue Analysis")
Then the filter is saved to my account
And it appears in my "Saved Filters" dropdown
And I can apply it with one click
And the filter loads in under 500ms
And I can delete saved filters from the dropdown menu
And I can rename saved filters in place

Dependencies: Requires user authentication (US-001)
Priority: High - Requested by 5+ customers
Story Points: 5
```

**Why it works:**
- Clear user value proposition
- Testable acceptance criteria
- Dependencies identified
- Prioritized and estimated

---

### Anti-Pattern: Incomplete User Story

**Example:**
```
User Story: US-300

Title: Dashboard improvements

As a user
I want a better dashboard
So that I can see my data better

Acceptance Criteria:
Make the dashboard better and prettier.
```

**Why it fails:**
- No specific user problem identified
- "Better" is completely subjective
- No measurable success criteria
- Ambiguous implementation guidance

**How to fix it:**
```
User Story: US-300

Title: Display key metrics above the fold on user dashboard

As a business user
I want the 5 key performance indicators (Revenue, Growth %, Customer Count,
Churn Rate, and ARPU) displayed prominently at the top of my dashboard
So that I can see critical metrics at a glance without scrolling

Current State: Metrics are in small charts scattered across the page,
requiring scrolling to see all five.

Acceptance Criteria:
- All 5 KPIs displayed in the top section before any scrolling
- Each KPI shows: metric name, current value, % change from previous period
- Color coding: green for positive, red for negative, grey for neutral
- KPI cards are at least 150px wide and 120px tall
- Values update in real-time (within 10 seconds of data change)
- Metric definitions available via tooltip
- Users can customize which 5 metrics to display
- Mobile view: KPIs stack vertically in full width
- Loads within 1 second

Dependencies: Requires real-time data API (US-205)
Priority: Critical
Story Points: 8
```

---

## Glossary and Terminology

### Requirement Levels

- **MUST/SHALL:** Mandatory - system cannot be released without this
- **SHOULD:** Highly desirable - aim to include but can release without
- **MAY:** Optional - nice to have, low priority
- **MUST NOT/SHALL NOT:** Prohibited - must never do this

### Quality Attributes for Requirements

- **Unambiguous:** Only one possible interpretation
- **Feasible:** Achievable with available resources and technology
- **Verifiable:** Can be tested or measured objectively
- **Consistent:** Doesn't conflict with other requirements
- **Complete:** Enough detail for implementation
- **Traceable:** Can be mapped to source and downstream artifacts
- **Prioritized:** Relative importance understood
- **Atomic:** Single concept or behavior (not compound)

---

## Checklist: Requirements Quality

Use this checklist to evaluate requirements:

- [ ] Requirement is specific and quantified (not vague)
- [ ] Requirement uses clear modal verb (SHALL, SHOULD, MUST, MUST NOT)
- [ ] Requirement is testable/measurable
- [ ] Requirement is feasible within project constraints
- [ ] Requirement is free of implementation details
- [ ] Requirement doesn't conflict with other requirements
- [ ] Requirement is clear to all stakeholders
- [ ] If functional: clear trigger, action, and expected outcome
- [ ] If non-functional: specific metric and threshold
- [ ] Requirement has clear rationale/business value
- [ ] Dependencies are identified
- [ ] Scope (in/out) is clear
- [ ] Requirement is atomic (single concept)
- [ ] Success criteria for this requirement are defined

---

## Quick Reference: Requirement Anti-Pattern Detection

| Red Flag | What to Do |
|---|---|
| "Nice to have," "good to have," without priority | Assign explicit priority level |
| Uses subjective terms: "fast," "easy," "intuitive," "nice" | Replace with measurable metrics |
| Describes HOW instead of WHAT | Refocus on outcome, not implementation |
| Multiple concepts in one requirement | Split into separate atomic requirements |
| No acceptance criteria defined | Define testable pass/fail conditions |
| Marked as "TBD" or incomplete | Complete definition before development |
| Conflicts with another requirement | Resolve trade-off with stakeholders |
| No clear owner or stakeholder | Identify responsible party |
| Requires unknown technology or resources | Research feasibility or mark as future work |
| No measurable success metric | Define quantifiable target |
