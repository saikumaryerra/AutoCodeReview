# Estimation Guide for Planning-Estimation-Agent

## Overview

Accurate estimation is critical for successful project planning. This guide covers proven techniques, common pitfalls, and strategies to improve estimation accuracy over time.

---

## Estimation Techniques

### 1. Planning Poker (Ideal for Teams)

**How it works:**
1. Product Owner presents a user story
2. Team members discuss the story and ask clarifying questions
3. Each team member privately selects a card/number from the Fibonacci sequence (1, 2, 3, 5, 8, 13, 21, 34...)
4. All estimates revealed simultaneously
5. If estimates diverge widely, discuss why and re-estimate
6. Repeat until consensus is reached (or close)

**Fibonacci Scale Meaning:**
- 1 = Trivial, well-defined, no risk
- 2-3 = Small, straightforward with minor unknowns
- 5 = Medium, some complexity or unknowns
- 8 = Large, significant complexity or risk
- 13 = Very large, high complexity or major unknowns
- 21+ = Too large, should be broken down further

**Pros:**
- Leverages team expertise
- Reveals different perspectives on complexity
- Prevents anchoring by outliers
- Encourages discussion and shared understanding

**Cons:**
- Time-consuming for large backlogs
- Requires in-person/synchronous meeting
- Can be derailed by dominant personalities

**Best For:** Agile teams, sprint planning, detailed stories

---

### 2. T-Shirt Sizing (Quick & Rough)

**How it works:**
1. Use relative sizing: XS, S, M, L, XL, XXL
2. Compare each story to previous work of known size
3. Place story in appropriate bucket
4. Convert to story points later if needed (XS=1-2, S=3, M=5-8, L=13-21, XL=34+)

**Pros:**
- Fast and intuitive
- Good for high-level roadmap planning
- Reduces false precision
- Works well for non-technical stakeholders

**Cons:**
- Less precise than planning poker
- Requires reference baseline stories
- Harder to track velocity trends
- May mask complexity differences within size bands

**Best For:** Backlog grooming, release planning, rough estimates

---

### 3. Three-Point Estimation

**How it works:**
1. Estimate three scenarios for each task:
   - **Optimistic (O):** Best case, everything goes right (10th percentile)
   - **Most Likely (M):** Most probable outcome
   - **Pessimistic (P):** Worst case within reason (90th percentile)

2. Calculate expected value: **E = (O + 4M + P) / 6**
3. Calculate variance/risk: **σ = (P - O) / 6**

**Example:**
- Optimistic: 4 hours
- Most Likely: 8 hours
- Pessimistic: 16 hours
- Expected: (4 + 4×8 + 16) / 6 = 9.3 hours
- Risk: (16 - 4) / 6 = 2 hours

**Pros:**
- Incorporates uncertainty explicitly
- Reveals risk/confidence in estimates
- Mathematical foundation
- Provides confidence intervals

**Cons:**
- More time-consuming
- Requires practice to calibrate estimates
- Can give false sense of precision
- Less useful for stories (vs. tasks)

**Best For:** Risk management, detailed task estimation, milestone scheduling

---

## Common Estimation Pitfalls

### 1. Anchoring Bias

**The Problem:** The first number mentioned disproportionately influences all subsequent estimates, even if it's arbitrary or wrong.

**Example:** If someone casually says "that's probably a 13," others gravitate toward 13 or nearby numbers.

**How to Avoid:**
- Use planning poker to get estimates independently first
- Don't state a number until all team members estimate
- Explicitly state anchoring is a risk
- For three-point estimates, come up with ranges independently

---

### 2. Optimism Bias

**The Problem:** Estimators underestimate time/effort because they:
- Underestimate task complexity
- Forget about interruptions, meetings, support requests
- Don't account for bugs discovered during testing
- Assume everything works perfectly

**Example:** "Testing this feature should take 1 day" → Actually takes 3 days

**How to Avoid:**
- Look at historical velocity for baseline
- Build in 15-25% buffer for unknowns
- Use three-point estimation to capture uncertainty
- Review actual vs. estimated after completion
- Discuss complexity drivers explicitly before estimating

---

### 3. Scope Creep in Estimation

**The Problem:** Original story scope expands during discussion, but original estimate stands, creating plan/reality mismatch.

**Example:** "User authentication" starts as login form, expands to include 2FA, password reset, email verification → still estimated at 5 points

**How to Avoid:**
- Define acceptance criteria clearly BEFORE estimation
- "Out of scope" parking lot for additional requests
- Formal change control process
- Separate "must-have" from "nice-to-have"
- Re-estimate if scope genuinely changes

---

### 4. Missing Dependencies

**The Problem:** Estimates miss required work:
- Integration with other systems
- Code review time
- Testing and QA cycles
- Documentation
- Deployment and monitoring setup

**Example:** Backend API estimated at 8 points, doesn't account for 5 points of integration and testing work

**How to Avoid:**
- Use a standard task breakdown template
- Define "done" upfront (including testing, docs, deployment)
- Involve QA and DevOps in estimation
- Review dependencies and blockers explicitly
- Add task-level estimates that roll up

---

### 5. Not Accounting for Context Switching

**The Problem:** Estimates assume dedicated focus, but team members juggle multiple priorities, meetings, support work.

**Real Example:**
- Sprint capacity: 8 hours × 5 days = 40 hours per person
- Actual available after meetings, support, admin: ~25-30 hours
- But estimates assume full 40 hours

**How to Avoid:**
- Use historical capacity, not theoretical capacity
- Track actual productive hours by team member
- Account for planned meetings, PTO, support work
- Build risk buffer (15-25%) into sprint commitment
- Monitor utilization and adjust assignments

---

### 6. Insufficient Information

**The Problem:** Stories estimated without enough context:
- Unclear requirements
- Unknown technical approach
- Unclear success criteria
- Hidden dependencies

**Example:** "Improve performance" could mean database optimization, caching, or code refactoring → vastly different effort

**How to Avoid:**
- Use story template with acceptance criteria
- Have product owner present to clarify
- Do technical spikes for unknown approaches
- Create task list during estimation
- Flag stories with high uncertainty separately

---

## Calibration & Improvement

### Track Your Accuracy

**Setup:**
1. Record estimated points for each story
2. At story completion, record actual points of effort (velocity)
3. Calculate estimation accuracy ratio

**Calculation:**
- **Estimation Ratio = Actual / Estimated**
- Ratio of 1.0 = Perfect estimate
- Ratio < 1.0 = Overestimated (estimated too high)
- Ratio > 1.0 = Underestimated (estimated too low)

**Example:**
- Estimated: 8 points, Actual: 10 points → Ratio = 1.25 (underestimated by 25%)
- Estimated: 13 points, Actual: 8 points → Ratio = 0.62 (overestimated by 38%)

### Monthly Calibration Review

**Process:**
1. Pull all completed stories from past month
2. Calculate estimation ratios for each
3. Calculate mean and standard deviation
4. Identify patterns:
   - Stories by team member (some naturally over/underestimate?)
   - Stories by type (always overestimate testing?)
   - Stories by size (large stories underestimated?)
   - Stories with certain complexity indicators?

5. Adjust process:
   - Provide feedback to estimators
   - Update estimation guidelines
   - Improve "definition of done"
   - Break down problematic story types differently

### Improving Over Time

**Week 1-4: Establish Baseline**
- Start tracking estimates vs. actual
- Document what goes into estimates
- Identify biggest sources of variance

**Week 5-8: Identify Patterns**
- Find systematic biases (tech underestimated, testing overestimated, etc.)
- Analyze by story type, complexity, team member
- Create hypothesis for improvements

**Week 9-12: Implement Changes**
- Adjust estimation approach (add 15% buffer to testing?)
- Update templates/checklists
- Train team on improvements
- Continue tracking

**Ongoing: Monitor & Adjust**
- Monthly calibration review
- Celebrate improving accuracy
- Share learnings with team
- Adjust as needed

---

## Estimation Best Practices

### 1. Estimate Collaboratively
- Include diverse perspectives (dev, QA, design, ops)
- Value dissenting opinions
- Require justification for outliers
- Avoid estimate averaging without discussion

### 2. Use Reference Stories
- Maintain library of "story points = X hours" examples
- Compare new story to known similar work
- Builds shared understanding
- Improves consistency

### 3. Break Down Large Stories
- Stories > 13 points = flag for breakdown
- Decompose into smaller, estimable pieces
- Reduces risk and improves accuracy
- Enables parallel work

### 4. Define "Done" Upfront
- Estimation includes all work to completion
- Covers dev, testing, docs, deployment
- Make "definition of done" explicit
- Include any supporting work

### 5. Reserve Capacity for Unknowns
- Don't commit to 100% capacity
- Reserve 15-25% for unexpected work
- Account for interruptions and support
- Adjust based on historical data

### 6. Separate Estimate from Commitment
- Estimate = how much effort we think it takes
- Commitment = what we promise to deliver
- Estimates are inputs to planning, not promises
- Adjust commitment based on team capacity

### 7. Revisit Estimates in Planning
- Story-level estimates vs. task-level estimates
- Sprint planning may break down further
- Adjust if new information emerges
- Don't let estimates become fixed

---

## Red Flags in Estimation

If you see these, investigate and re-estimate:

- **"That's probably a 2 or a 21"** → Too uncertain, needs breakdown
- **"It's like that other story"** → Without understanding why
- **Silence from technical team** → They're uncomfortable with scope
- **Out-of-scope discussion during estimation** → Scope not clear
- **"We can parallel this"** → Accounting for dependencies?
- **"We've never done this before"** → Technical risk? Needs spike?
- **Story title vague** → Description insufficient
- **Estimate doesn't match complexity discussion** → Misalignment

---

## Summary: Estimation Workflow

1. **Prepare:** Clear requirements, acceptance criteria, out-of-scope defined
2. **Estimate:** Planning poker or team discussion using proven technique
3. **Breakdown:** Decompose into testable, completable tasks
4. **Capacity Plan:** Consider realistic team availability + buffer
5. **Commit:** Only what team can complete + Definition of Done
6. **Track:** Record actual vs. estimated for each story
7. **Review:** Monthly calibration to improve accuracy
8. **Iterate:** Adjust process based on historical performance

---

## Additional Resources

- Fibonacci sequence justification: Why 1,2,3,5,8 vs. 1,2,3,4,5? → Humans better at relative comparison than absolute estimation
- Cone of Uncertainty: Estimates get more accurate as project progresses (±25% in planning phase, ±10% after design)
- Historical velocity: Best predictor of future capacity is actual past performance
