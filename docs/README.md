# BOUNTYExpo Documentation

This directory contains detailed documentation for various aspects of the BOUNTYExpo platform.

## 🆕 Recently Added: Low Priority Deferred Issues

Comprehensive documentation for four low-priority improvements that should be implemented only when metrics indicate they are needed:

- **[Low Priority Deferred Issues Index](./LOW_PRIORITY_DEFERRED_ISSUES_INDEX.md)** - Master index and decision guide
  - [Async Ordering Guide](./ASYNC_ORDERING_GUIDE.md) - Profile → Stripe operation sequencing
  - [Stripe Customer Optimization](./STRIPE_CUSTOMER_OPTIMIZATION_GUIDE.md) - Eager customer creation plan
  - [Rate Limiting Enhancement](./RATE_LIMITING_ENHANCEMENT_GUIDE.md) - Redis + CAPTCHA strategies
  - [Analytics Naming Conventions](./ANALYTICS_NAMING_CONVENTIONS.md) - Event standardization guide

## 📚 Documentation Categories

### Architecture & Design
- [Messenger QoL Architecture](./MESSENGER_QOL_ARCHITECTURE.md)
- [E2E Encryption Roadmap](./E2E_ENCRYPTION_ROADMAP.md)
- [Auth Navigation](./AUTH_NAVIGATION.md)
- [Routing Audit](./ROUTING_AUDIT.md)
- [Navigation Context Fix](./NAVIGATION_CONTEXT_FIX.md)

### User Flows
- [Onboarding](./ONBOARDING.md)
- [Onboarding Quick Start](./ONBOARDING_QUICK_START.md)
- [Hunter Flow Validation](./hunter-flow-validation.md)
- [Hunter In-Progress Flow](./hunter-in-progress-flow.md)
- [Hunter vs Poster Flow Comparison](./hunter-poster-flow-comparison.md)
- [Bounty Dashboard Flow](./bounty-dashboard-flow.md)

### Features & Components
- [Edit Profile Redesign](./EDIT_PROFILE_REDESIGN.md)
- [Edit Profile Visual Guide](./EDIT_PROFILE_VISUAL_GUIDE.md)
- [Avatar Upload](./AVATAR_UPLOAD.md)
- [Email Verification Gate](./AUTH_EMAIL_VERIFICATION_GATE.md)
- [Email Verification Quick Start](./EMAIL_VERIFICATION_QUICK_START.md)
- [Messenger QoL UI Mockup](./MESSENGER_QOL_UI_MOCKUP.md)

### Testing & Quality
- [Payment Testing Guide](./PAYMENT_TESTING_GUIDE.md)
- [Performance Testing](./PERFORMANCE_TESTING.md)
- [Search Testing](./SEARCH_TESTING.md)
- [Onboarding Test Checklist](./ONBOARDING_TEST_CHECKLIST.md)
- [Performance Audit](./perf-audit.md)

### Integration & Setup
- [Supabase Messaging Setup](./SUPABASE_MESSAGING_SETUP.md)
- [Supabase Messaging Quickstart](./SUPABASE_MESSAGING_QUICKSTART.md)
- [Stripe Connect Troubleshooting](./STRIPE_CONNECT_TROUBLESHOOTING.md)

### Brand & Style
- [Brand Voice](./BRAND_VOICE.md)

### Other Resources
- [PR Implementation Summary](./PR_IMPLEMENTATION_SUMMARY.md)
- [Legal: Privacy Policy](./privacy.html)
- [Legal: Terms of Service](./terms.html)

## 🔍 Finding What You Need

### For New Engineers
Start here:
1. [Onboarding Quick Start](./ONBOARDING_QUICK_START.md)
2. [Async Ordering Guide](./ASYNC_ORDERING_GUIDE.md) - Critical for backend work
3. [Architecture documents](#architecture--design)

### For Feature Development
- Check [User Flows](#user-flows) for understanding current behavior
- Review [Features & Components](#features--components) for similar features
- Consult [Testing guides](#testing--quality) before shipping

### For Optimization Work
- Review [Low Priority Deferred Issues](./LOW_PRIORITY_DEFERRED_ISSUES_INDEX.md)
- Check [Performance Testing](./PERFORMANCE_TESTING.md)
- See [Performance Audit](./perf-audit.md)

### For Troubleshooting
- [Stripe Connect Troubleshooting](./STRIPE_CONNECT_TROUBLESHOOTING.md)
- [Navigation Context Fix](./NAVIGATION_CONTEXT_FIX.md)
- Check relevant feature documentation

## 📝 Document Maintenance

### When to Update Documentation
- After implementing features documented here
- When architectural patterns change
- When new best practices are established
- When metrics indicate deferred items should be prioritized

### Documentation Standards
- Use Markdown format
- Include code examples where relevant
- Add diagrams for complex flows
- Reference related documentation
- Keep status and version info up to date

## 🤝 Contributing to Docs

When adding new documentation:
1. Place it in this `docs/` directory
2. Use descriptive filenames with underscores or hyphens
3. Add an entry to this README in the appropriate category
4. Include version, date, and status information in your doc
5. Link to related documentation

## 📚 Related Documentation

Documentation also exists in the root directory and subdirectories:
- Root README: [../README.md](../README.md)
- Copilot Instructions: [../COPILOT_AGENT.md](../COPILOT_AGENT.md)
- API Documentation: [../services/api/README.md](../services/api/README.md)
- Server Documentation: [../server/README.md](../server/README.md)

## 🔗 Quick Links

- [Main README](../README.md) - Project overview and setup
- [Architecture Docs](../) - Root-level architecture files
- [API Docs](../services/api/) - Backend API documentation
- [Testing](../tests/) - Test suite documentation

---

**Last Updated:** 2026-01-02  
**Maintained By:** BOUNTYExpo Team
