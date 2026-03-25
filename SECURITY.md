# Security Policy

## Supported Versions

During the external beta period the following versions receive security updates:

| Version | Supported |
| ------- | --------- |
| External Beta (latest `main`) | ✅ Yes |
| Older internal builds | ❌ No |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability in BOUNTYExpo, please disclose it responsibly by following these steps:

1. **Email**: Send a detailed report to the project maintainer. Include:
   - A clear description of the vulnerability
   - Steps to reproduce (proof-of-concept code or screenshots if applicable)
   - The potential impact
   - Any suggested mitigations

2. **GitHub Private Security Advisory** (preferred): Use the GitHub [Report a Vulnerability](https://github.com/kodaksax/Bounty-production/security/advisories/new) feature to submit a private advisory directly.

### Response Timeline

| Step | Target Time |
|------|-------------|
| Acknowledge receipt | Within 48 hours |
| Initial assessment | Within 5 business days |
| Patch for critical issues | Within 14 days |
| Public disclosure | After patch is available |

We appreciate responsible disclosure and will credit researchers who follow this policy (unless they prefer to remain anonymous).

## Security Measures in Place

BOUNTYExpo implements the following security controls:

- **Authentication**: Supabase JWT with automatic token refresh; tokens stored in Expo SecureStore (iOS Keychain / Android Keystore).
- **Input Sanitization**: All user-supplied text is sanitised before storage and display (see `lib/utils/sanitization.ts`).
- **Rate Limiting**: Auth endpoints are limited client-side and server-side to prevent brute-force attacks.
- **Payment Security**: All card data is handled exclusively by Stripe — card numbers and CVVs are never stored by the application.
- **HTTPS / TLS**: All production API traffic is encrypted in transit.
- **Environment Secrets**: API keys, JWT secrets, and webhook secrets are loaded from environment variables and are never committed to version control.
- **Row-Level Security (RLS)**: Supabase RLS policies ensure users can only access their own data.

## Scope

The following are **in scope** for security reports:

- Authentication and session management flaws
- Authorization bypass or privilege escalation
- Injection vulnerabilities (SQL, XSS, etc.)
- Sensitive data exposure (tokens, PII, payment data)
- Payment flow vulnerabilities
- Insecure direct object reference (IDOR)

The following are **out of scope**:

- Denial-of-service attacks that require significant resources to reproduce
- Issues in third-party services (Supabase, Stripe, Expo) — report these directly to the respective vendor
- Spam or social-engineering attacks
- Issues only reproducible on jailbroken / rooted devices

## Known Limitations (Beta)

See [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) for a list of documented limitations and items scheduled for post-beta resolution.
