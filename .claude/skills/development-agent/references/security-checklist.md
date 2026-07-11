# Security Code Review Checklist (OWASP-Aligned)

## A01: Injection
- [ ] SQL queries use parameterized statements, not string concatenation
- [ ] NoSQL injection is prevented with proper query construction
- [ ] OS command injection is prevented with proper escaping
- [ ] LDAP injection is prevented with proper encoding
- [ ] XML injection is prevented with proper parsing
- [ ] No dynamic code execution from user input (eval, exec)
- [ ] Template injection is prevented with safe rendering

## A02: Broken Authentication
- [ ] Passwords are hashed with strong algorithms (bcrypt, scrypt, PBKDF2)
- [ ] Session tokens are cryptographically secure
- [ ] Password reset tokens expire after reasonable time
- [ ] Multi-factor authentication support is considered
- [ ] Account lockout after failed login attempts
- [ ] No sensitive data exposed in URLs or logs
- [ ] Default credentials are changed or removed
- [ ] Authentication failures are logged without exposing credentials

## A03: Broken Access Control
- [ ] Authorization checks are performed on every protected endpoint
- [ ] Role-based access control (RBAC) is properly implemented
- [ ] Users cannot access resources outside their scope
- [ ] Admin functions require admin privileges
- [ ] Object references cannot be manipulated to access others' data
- [ ] Method-level authorization is enforced
- [ ] Least privilege principle is applied
- [ ] Access logs are maintained for audit trails

## A04: Insecure Data Exposure
- [ ] Sensitive data is encrypted at rest (PII, credentials, tokens)
- [ ] Data in transit uses TLS/HTTPS
- [ ] No sensitive data in logs or error messages
- [ ] Database backups are encrypted
- [ ] PII is not exposed in URLs or query parameters
- [ ] Sensitive data is not cached insecurely
- [ ] Data retention policies are enforced
- [ ] Sensitive data is properly cleared from memory

## A05: Broken Input Validation
- [ ] All user input is validated server-side (not just client-side)
- [ ] Whitelist approach is used for validation
- [ ] File uploads are validated (type, size, content)
- [ ] File paths prevent directory traversal attacks
- [ ] Numeric inputs are validated for range and type
- [ ] Email/URL inputs are properly validated
- [ ] Date inputs are validated for reasonable values
- [ ] Unicode and encoding issues are handled

## A06: Broken Cryptography
- [ ] Strong encryption algorithms are used (AES-256, not DES or MD5)
- [ ] Cryptographic keys are securely generated and stored
- [ ] Key rotation is implemented for long-lived keys
- [ ] Random number generation uses cryptographically secure sources
- [ ] No use of deprecated or broken algorithms
- [ ] Initialization vectors (IVs) are random and unique
- [ ] HTTPS/TLS versions are current (TLS 1.2+)
- [ ] Certificate validation is enforced

## A07: Insufficient Logging & Monitoring
- [ ] Security-relevant events are logged (login, access, changes)
- [ ] Logs do not contain sensitive information
- [ ] Log timestamps are present and accurate
- [ ] Logs are protected from tampering and unauthorized access
- [ ] Logs are retained for adequate audit periods
- [ ] Failed security operations are logged
- [ ] Monitoring alerts exist for suspicious activity
- [ ] Incident response procedures are documented

## A08: Broken Error Handling
- [ ] Error messages don't reveal system details (versions, paths, SQL)
- [ ] Stack traces are not exposed to end users
- [ ] Generic error messages are shown to users
- [ ] Detailed errors are logged server-side for debugging
- [ ] Exceptions are caught at appropriate levels
- [ ] No sensitive data in error responses
- [ ] Error codes don't leak information
- [ ] Resource cleanup occurs on errors

## A09: Weak Dependency Management
- [ ] Dependencies are regularly scanned for vulnerabilities
- [ ] Known vulnerable versions are not used
- [ ] Dependency versions are pinned (not auto-updated to latest)
- [ ] Supply chain attacks are mitigated (checksum verification)
- [ ] Deprecated packages are replaced
- [ ] Third-party code is reviewed for security
- [ ] Minimal dependencies are used (avoid bloat)
- [ ] License compliance is verified

## A10: Server-Side Request Forgery (SSRF)
- [ ] No server-side requests to user-controlled URLs
- [ ] Whitelist of allowed external services is enforced
- [ ] Internal network access is restricted
- [ ] DNS rebinding attacks are prevented
- [ ] Cloud metadata endpoints are protected
- [ ] Redirects are validated and don't bypass SSRF protections
- [ ] Rate limiting is applied to outbound requests
