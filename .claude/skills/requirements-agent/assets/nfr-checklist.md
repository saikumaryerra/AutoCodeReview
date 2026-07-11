# Non-Functional Requirements (NFR) Checklist

**Project:** [Project Name]
**Date:** [Date]
**Reviewed By:** [Name]

---

## Performance

- [ ] Response time requirement defined (e.g., < 2 seconds for user actions)
- [ ] Throughput requirement defined (e.g., X requests per second)
- [ ] Data processing time requirements documented (batch operations, reports)
- [ ] API response time SLAs established
- [ ] Database query performance targets set
- [ ] Load time requirements for critical UI components specified
- [ ] Cache strategy requirements defined
- [ ] Performance testing approach documented

**Performance Targets:**
- Page Load Time: [Target]
- API Response Time: [Target]
- Throughput: [Target]
- Other: [Target]

---

## Scalability

- [ ] Expected user growth rate documented
- [ ] Peak concurrent user capacity defined
- [ ] Data volume growth projections included
- [ ] Horizontal scalability requirements specified
- [ ] Vertical scalability limits identified
- [ ] Load balancing strategy requirements documented
- [ ] Database scaling approach defined
- [ ] Storage scaling requirements established

**Scalability Targets:**
- Max Concurrent Users: [Target]
- Data Growth: [Target]
- Geographic Distribution: [Yes/No]

---

## Security

- [ ] Authentication method(s) specified (OAuth, SAML, MFA, etc.)
- [ ] Authorization/access control model defined
- [ ] Data encryption requirements (at-rest and in-transit)
- [ ] Password policy requirements documented
- [ ] API security standards specified (rate limiting, API keys, tokens)
- [ ] Vulnerability testing/scanning requirements defined
- [ ] Secure coding standards referenced
- [ ] Data classification and handling procedures documented
- [ ] Third-party security compliance requirements (PCI-DSS, HIPAA, SOC2, etc.)
- [ ] Security incident response procedures outlined

**Security Standards:**
- Encryption Standard: [e.g., AES-256, TLS 1.2+]
- Authentication: [Methods]
- Compliance: [Standards required]

---

## Availability

- [ ] System uptime SLA defined (e.g., 99.9% uptime)
- [ ] Planned maintenance windows specified
- [ ] Disaster recovery plan requirements documented
- [ ] Failover/redundancy strategy specified
- [ ] Backup frequency and retention policy defined
- [ ] Recovery time objective (RTO) established
- [ ] Recovery point objective (RPO) established
- [ ] Status monitoring and alerting requirements documented

**Availability Targets:**
- SLA Uptime: [Target percentage]
- RTO: [Target time]
- RPO: [Target time]
- Planned Downtime: [Frequency/Duration]

---

## Reliability

- [ ] Mean time between failures (MTBF) target defined
- [ ] Mean time to repair (MTTR) target defined
- [ ] Error rate thresholds established
- [ ] Fault tolerance requirements specified
- [ ] Graceful degradation strategy documented
- [ ] System health monitoring requirements defined
- [ ] Retry logic and circuit breaker patterns specified

**Reliability Targets:**
- MTBF: [Target]
- MTTR: [Target]
- Error Rate: [Target]

---

## Usability

- [ ] Target user profiles/personas documented
- [ ] Accessibility standards required (WCAG 2.1 Level AA/AAA)
- [ ] UI/UX design guidelines specified
- [ ] User testing requirements documented
- [ ] Internationalization requirements (language support)
- [ ] Mobile device support requirements specified
- [ ] Browser compatibility matrix defined
- [ ] Help/documentation requirements outlined

**Usability Standards:**
- Target Browsers: [List]
- Accessibility Level: [WCAG Standard]
- Supported Devices: [Types]

---

## Accessibility

- [ ] WCAG 2.1 compliance level specified
- [ ] Screen reader compatibility required
- [ ] Keyboard navigation support required
- [ ] Color contrast ratio standards (WCAG AA/AAA)
- [ ] Text alternatives for images/media defined
- [ ] Form labels and error messages requirements
- [ ] Focus indicators and visual cues specified
- [ ] Alternative input methods supported (voice, gestures, etc.)
- [ ] Accessibility testing tools and audits specified

**Accessibility Targets:**
- WCAG Level: [Target level]
- Testing Approach: [Methods]

---

## Maintainability

- [ ] Code quality standards (complexity, duplication, coverage)
- [ ] Documentation requirements specified (code, architecture, API)
- [ ] Deployment process complexity acceptable
- [ ] Logging and monitoring requirements defined
- [ ] Technical debt management process outlined
- [ ] Dependency management strategy specified
- [ ] Configuration management requirements documented
- [ ] Version control branching strategy defined

**Code Quality Targets:**
- Test Coverage: [Target percentage]
- Code Style: [Standard]
- Documentation: [Level required]

---

## Portability

- [ ] Supported operating systems listed
- [ ] Supported browsers and versions specified
- [ ] Supported devices/screen sizes defined
- [ ] Database portability requirements specified
- [ ] Cloud provider independence needs documented
- [ ] Container/virtualization requirements specified
- [ ] Data export/import format requirements defined

**Portability Targets:**
- OS Support: [List]
- Browser Support: [List]
- Device Types: [List]

---

## Compliance/Regulatory

- [ ] Industry regulations applicable identified (GDPR, HIPAA, PCI-DSS, etc.)
- [ ] Data protection requirements documented
- [ ] Privacy policy requirements specified
- [ ] Audit trail requirements defined
- [ ] Data residency requirements specified
- [ ] Right to be forgotten/data deletion requirements
- [ ] Consent management requirements documented
- [ ] Regular compliance review schedule established

**Compliance Requirements:**
- Regulations: [List]
- Audit Frequency: [Schedule]
- Certifications Required: [List]

---

## Data Retention

- [ ] Data retention periods defined by data type
- [ ] Archival strategy documented
- [ ] Data purge schedule specified
- [ ] Legal hold procedures outlined
- [ ] Data backup retention policy defined
- [ ] Secure deletion/destruction procedures specified
- [ ] Data classification for retention purposes established

**Retention Policies:**
- Transactional Data: [Period]
- User Data: [Period]
- Logs: [Period]
- Backups: [Period]

---

## Internationalization/Localization

- [ ] Supported languages documented
- [ ] Supported locales/regions listed
- [ ] Date/time format requirements specified
- [ ] Currency handling requirements documented
- [ ] Text expansion considerations for translations
- [ ] Font and character set support requirements
- [ ] Right-to-left (RTL) language support required
- [ ] Localized content management requirements

**Localization Targets:**
- Supported Languages: [List]
- Supported Regions: [List]
- Default Language: [Language]

---

## Disaster Recovery

- [ ] Disaster recovery plan (DRP) documented
- [ ] Recovery strategy for various failure scenarios specified
- [ ] Backup frequency and replication strategy defined
- [ ] Geographic redundancy requirements (if applicable)
- [ ] Testing frequency for disaster recovery procedures
- [ ] Communication plan during outages outlined
- [ ] Alternative systems/workarounds documented

**DR Targets:**
- RTO: [Target time]
- RPO: [Target time]
- Testing Frequency: [Schedule]

---

## Audit/Logging

- [ ] Audit logging requirements for sensitive operations
- [ ] Log retention period specified
- [ ] Log access controls and security requirements
- [ ] Log format and content standards defined
- [ ] Real-time alerting requirements for critical events
- [ ] Compliance audit trail requirements
- [ ] Log analysis and reporting capabilities needed
- [ ] System event logging requirements

**Logging Standards:**
- Retention Period: [Duration]
- Log Level Detail: [Basic/Standard/Detailed]
- Alert Thresholds: [Define]

---

## Summary and Approval

**Total NFR Categories Reviewed:** 14

**NFR Definition Status:**
- [ ] All critical NFRs documented
- [ ] All NFR targets quantified and realistic
- [ ] NFR measurability verified
- [ ] Trade-offs between conflicting NFRs identified and resolved
- [ ] Testing/validation approach defined for each NFR
- [ ] NFRs aligned with business objectives
- [ ] Resource/budget implications assessed

---

**Reviewed and Approved By:**

| Role | Name | Date | Signature |
|---|---|---|---|
| Product Manager | | | |
| Technical Architect | | | |
| Quality Assurance Lead | | | |
| Operations/Infrastructure | | | |
