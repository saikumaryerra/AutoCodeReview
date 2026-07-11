# Quality Metrics Guide: What to Measure and Why

## Introduction
Effective quality metrics provide visibility into system health, guide decision-making, and enable continuous improvement. This guide covers key metrics, their purpose, and how to interpret them.

## Code Quality Metrics

### Code Complexity (Cyclomatic Complexity)
**What:** Number of independent code paths through a function or module
**Why:** High complexity increases bugs, reduces testability, and makes maintenance harder
**Target:** <10 per function, <15 per class
**How to Improve:**
- Break functions into smaller, focused units
- Reduce conditional branches
- Extract complex logic into helper functions

### Code Coverage
**What:** Percentage of code executed by automated tests
**Why:** Higher coverage detects more bugs early and reduces production incidents
**Target:** 80%+ overall, 90%+ for critical paths
**Limitations:** Coverage doesn't guarantee quality; focus on meaningful tests

### Code Duplication
**What:** Percentage of code repeated across the codebase
**Why:** Duplication increases maintenance burden and inconsistency
**Target:** <5%
**How to Improve:**
- Extract common code into utilities
- Use inheritance/composition appropriately
- Refactor similar logic patterns

### Technical Debt Ratio
**What:** Estimated effort to fix all issues vs. effort to deliver current feature
**Why:** Unaddressed debt increases maintenance costs and slows development
**Target:** <5%
**What to Track:**
- Known code smells
- Incomplete tests
- Poorly documented code
- Outdated dependencies

## Testing Metrics

### Test Pass Rate
**What:** Percentage of automated tests passing
**Why:** Indicates code quality and system stability
**Target:** >95% (investigate every failure)
**Action:** Fix failing tests immediately; prioritize stability

### Defect Density
**What:** Number of bugs found per 1000 lines of code
**Why:** Indicates quality of development and testing processes
**Target:** <0.5 defects per KLOC in production
**Track:**
- Bugs by severity
- Bugs by component
- Time to resolution

### Test Execution Time
**What:** Total duration to run all automated tests
**Why:** Fast feedback loops enable faster development cycles
**Target:** <30 minutes for full suite
**How to Improve:**
- Parallelize tests
- Optimize slow tests
- Use test categorization (unit/integration/e2e)

### Flaky Test Count
**What:** Tests that fail intermittently without code changes
**Why:** Flaky tests undermine confidence and reduce reliability
**Target:** 0
**Action:** Investigate and fix immediately; quarantine if necessary

## Deployment & Release Metrics

### Lead Time for Changes
**What:** Time from code commit to deployment in production
**Why:** Shorter lead time enables faster feature delivery and quicker bug fixes
**Target:** <1 day
**What to Track:**
- Development time
- Review time
- Testing time
- Deployment time

### Deployment Frequency
**What:** How often code is deployed to production
**Why:** Frequent deployments reduce risk per deployment
**Target:** Multiple times per day (or business requirement)
**Related:** Smaller changes = lower risk

### Mean Time to Recovery (MTTR)
**What:** Average time to restore service after a failure
**Why:** Measures operational resilience and incident response effectiveness
**Target:** <15 minutes for critical services
**How to Improve:**
- Automated rollback capabilities
- Clear runbooks
- On-call training
- Monitoring/alerting

### Change Failure Rate
**What:** Percentage of deployments causing production incidents
**Why:** Indicates quality and risk of changes
**Target:** <15%
**How to Improve:**
- Better testing
- Code reviews
- Staged rollouts
- Feature flags

## Operational Metrics

### System Availability
**What:** Percentage of time service is accessible and functional
**Why:** Core indicator of user satisfaction and business impact
**Target:** 99.9%+ (depends on SLA)
**Measure:**
- Uptime vs. downtime
- Planned vs. unplanned incidents

### Error Rate
**What:** Percentage of requests resulting in errors
**Why:** Direct indicator of system health and user impact
**Target:** <0.1%
**Monitoring:**
- 4xx errors (client errors)
- 5xx errors (server errors)
- Application-level errors

### Performance (Response Time)
**What:** Time to complete a request/transaction
**Why:** Directly affects user experience and satisfaction
**Target:** API <200ms, Web Pages <2s
**Track by:**
- Percentiles (p50, p95, p99)
- User segments
- Time of day
- API endpoints

## Security & Compliance Metrics

### Vulnerability Count
**What:** Number of known security vulnerabilities in code or dependencies
**Why:** Reduces attack surface and risk exposure
**Target:** 0 critical, <5 high-severity
**Categories:**
- Application vulnerabilities (SAST)
- Runtime vulnerabilities (DAST)
- Dependency vulnerabilities

### Security Test Coverage
**What:** Percentage of security requirements covered by automated tests
**Why:** Ensures security is maintained throughout development
**Target:** >80%
**What to Test:**
- Authentication
- Authorization
- Input validation
- Encryption

### Dependency Age
**What:** How current are third-party libraries
**Why:** Old dependencies may contain security vulnerabilities
**Target:** <90% within 1 major version of latest
**How to Improve:**
- Regular dependency updates
- Automated dependency scanning
- Version compatibility testing

## Team & Process Metrics

### Code Review Cycle Time
**What:** Average time from PR submission to approval
**Why:** Reduces bottlenecks and enables faster delivery
**Target:** <24 hours
**Optimize:**
- Clear review criteria
- Smaller PRs
- Reviewer assignment
- Process efficiency

### Velocity
**What:** Amount of work completed per sprint
**Why:** Helps with capacity planning and forecasting
**Target:** Stable and predictable
**Context:** Track trends, not absolute values

### Cycle Time
**What:** Time from work starts to production deployment
**Why:** Indicates process efficiency
**Target:** <1 week
**Components:**
- Development time
- Review time
- Testing time
- Deployment time

## Dashboard Integration

Effective metrics dashboards should:
- **Show trends** (improvement/regression over time)
- **Set targets** (clear goals to work toward)
- **Provide context** (understand why metrics matter)
- **Enable action** (point to specific improvements)
- **Update regularly** (daily or weekly minimum)

## Cautions

- Don't optimize for metrics; optimize for quality outcomes
- Combine metrics for holistic view (no single metric tells full story)
- Adjust targets based on domain and risk tolerance
- Automate collection to reduce manual overhead
- Regularly review metric relevance and adjust portfolio

---
**Version:** 1.0
**Last Updated:** [Date]
