# Work Breakdown Structure (WBS)

**Project:** [Project Name]
**Date Created:** [Date]
**Last Updated:** [Date]
**Version:** 1.0

---

## WBS Hierarchy

### 1. [Phase/Epic Name]
**Task ID:** WBS-1
**Description:** [High-level description of phase/epic]

#### 1.1 [Feature/Component Name]
**Task ID:** WBS-1.1
**Name:** [Feature/Component Name]
**Description:** [Detailed description of the work]
**Owner:** [Team Member Name]
**Estimate:** [Size in story points/hours]
**Effort Unit:** Story Points / Hours
**Dependencies:** [Task IDs this depends on, or "None"]
**Status:** Not Started / In Progress / Completed
**Priority:** Critical / High / Medium / Low
**Notes:** [Additional context]

##### 1.1.1 [Subtask Name]
**Task ID:** WBS-1.1.1
**Name:** [Subtask Name]
**Description:** [What needs to be done]
**Owner:** [Team Member Name]
**Estimate:** [Size in story points/hours]
**Dependencies:** [Related task IDs]
**Status:** Not Started / In Progress / Completed
**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

##### 1.1.2 [Subtask Name]
**Task ID:** WBS-1.1.2
**Name:** [Subtask Name]
**Description:** [What needs to be done]
**Owner:** [Team Member Name]
**Estimate:** [Size in story points/hours]
**Dependencies:** [Related task IDs]
**Status:** Not Started / In Progress / Completed
**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

#### 1.2 [Feature/Component Name]
**Task ID:** WBS-1.2
**Name:** [Feature/Component Name]
**Description:** [Detailed description]
**Owner:** [Team Member Name]
**Estimate:** [Size]
**Dependencies:** WBS-1.1
**Status:** Not Started / In Progress / Completed
**Priority:** High / Medium / Low

##### 1.2.1 [Subtask Name]
**Task ID:** WBS-1.2.1
**Name:** [Subtask Name]
**Description:** [What needs to be done]
**Owner:** [Team Member Name]
**Estimate:** [Size]
**Dependencies:** WBS-1.1.2
**Status:** Not Started / In Progress / Completed

---

## Summary Table

| Task ID | Name | Owner | Estimate | Dependencies | Status |
|---------|------|-------|----------|--------------|--------|
| WBS-1 | [Phase Name] | [Owner] | [Total Est.] | None | Not Started |
| WBS-1.1 | [Feature Name] | [Owner] | [Points] | None | Not Started |
| WBS-1.1.1 | [Subtask] | [Owner] | [Points] | None | Not Started |
| WBS-1.1.2 | [Subtask] | [Owner] | [Points] | None | Not Started |
| WBS-1.2 | [Feature Name] | [Owner] | [Points] | WBS-1.1 | Not Started |
| WBS-1.2.1 | [Subtask] | [Owner] | [Points] | WBS-1.1.2 | Not Started |

---

## Dependency Map

```
WBS-1
├── WBS-1.1
│   ├── WBS-1.1.1
│   └── WBS-1.1.2
└── WBS-1.2 (depends on WBS-1.1)
    └── WBS-1.2.1 (depends on WBS-1.1.2)
```

---

## Key Metrics

- **Total Estimated Effort:** [Sum of all estimates]
- **Number of Work Items:** [Count of leaf tasks]
- **Critical Path:** [List of dependent tasks on critical path]
- **Baseline Schedule:** [Start Date] to [End Date]

---

## Notes & Assumptions

- [Key assumption 1]
- [Key assumption 2]
- [Constraint or risk]
