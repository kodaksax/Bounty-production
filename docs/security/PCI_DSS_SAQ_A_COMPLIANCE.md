# PCI DSS SAQ-A Compliance Review

> **Status:** Self-assessment documentation. Before accepting live card payments at
> public-launch scale, an authorized officer of BountyExpo must sign and submit
> the official Stripe SAQ-A questionnaire (via the Stripe Dashboard → Compliance
> → Start Questionnaire). This document captures the compliance posture and
> evidence that supports each SAQ-A response.

## 1. Scope & Eligibility

**Self-Assessment Questionnaire (SAQ) selected: `SAQ A`.**

SAQ A applies to card-not-present merchants that have **fully outsourced** all
cardholder data (CHD) functions to PCI DSS–validated third-party service
providers and that do **not electronically store, process, or transmit any
cardholder data** on their own systems.

### SAQ-A eligibility criteria (all must be `true`)

| # | Criterion | BountyExpo | Evidence |
|---|-----------|-----------|----------|
| 1 | Merchant only accepts card-not-present (e-commerce / mail-order / telephone-order) transactions | ✅ Yes — mobile app only; no card-present POS | `app.json`, `components/add-card-modal.tsx` |
| 2 | All processing of cardholder data is outsourced to a PCI DSS–validated third-party service provider | ✅ Yes — Stripe (AoC on file) | `lib/services/stripe-sdk.ts`, `lib/services/payment-methods-service.ts` |
| 3 | Merchant has confirmed that the third-party service provider(s) are PCI DSS compliant | ✅ Yes — Stripe is a PCI DSS Level 1 service provider | <https://stripe.com/docs/security/stripe>, [Stripe AoC](https://stripe.com/files/PCI-DSS-AOC.pdf) |
| 4 | Merchant does not electronically store, process, or transmit any cardholder data on its systems or premises; it only receives paper reports or receipts with CHD | ✅ Yes — CHD is captured in the Stripe native SDK (React Native Stripe SDK) or Stripe Payment Element (WebView). The app/server only ever see tokenized Stripe IDs (`pm_...`, `seti_...`, `pi_...`). | See §3 below |
| 5 | Merchant's payment-page / redirect / SDK is served by the service provider (no iframes/redirects hosted by the merchant) | ✅ Yes — card UI is rendered by the Stripe SDK; the Payment Element is served from `js.stripe.com`; the Connect onboarding UI is the Stripe-hosted embedded component | `components/connect-embedded-webview.tsx`, `supabase/functions/connect/index.ts` |

Because all five criteria are met, BountyExpo qualifies for **SAQ A** (the
shortest questionnaire). If any future change causes CHD to flow through our
systems (for example, building a custom card form that POSTs a PAN to our API),
scope will escalate to **SAQ A-EP** or **SAQ D** and this document must be
revisited **before** that change ships.

### Merchant level

| Attribute | Value |
|-----------|-------|
| Annual card-not-present transaction volume | < 20,000 (pre-launch) |
| Merchant level | **Level 4** |
| Acquirer | Stripe Payments (processor-of-record) |
| Assessment type | Annual self-assessment (SAQ A) + quarterly ASV scan of any public-facing CDE — **not required** under SAQ A since no CDE systems are in scope |

## 2. Shared Responsibility with Stripe

Stripe's
[Shared Responsibility model](https://stripe.com/docs/security/guide#shared-responsibilities)
splits obligations as follows. Controls marked **Stripe** are fully delegated;
controls marked **BountyExpo** remain our responsibility even under SAQ A.

| Area | Stripe | BountyExpo |
|------|--------|-----------|
| Card data capture, tokenization, storage | ✅ | — |
| Card data transmission to card networks | ✅ | — |
| HSM / key management for card data | ✅ | — |
| PCI DSS Level 1 certification of the CDE | ✅ | — |
| Fraud / Radar rules engine | ✅ | Tune rules per our risk policy |
| Strong Customer Authentication (SCA / 3DS) | ✅ | Wire `next_action` / `requires_action` flows (done) |
| API key confidentiality | — | ✅ Store secret key server-side only; publishable key may be embedded in the app |
| Webhook signature verification | — | ✅ `stripe.webhooks.constructEvent` in `services/api/src/routes/payments.ts` |
| TLS on all traffic to Stripe | Stripe terminates TLS | ✅ App/server only call `https://api.stripe.com` and `https://*.supabase.co` |
| Access control over Stripe Dashboard | — | ✅ MFA required; role-scoped team members |
| Keeping the Stripe SDK up to date | — | ✅ Dependabot / manual upgrades in `package.json` |
| Preventing CHD from leaking into app/server logs or DB | — | ✅ See §4 |
| Security of the mobile app binary (anti-tamper, SSL pinning) | — | ✅ Best-effort (R.N. Stripe SDK performs its own TLS to Stripe) |

## 3. Cardholder Data Flow (Proof of SAQ-A Scope)

The following diagram shows that PAN / expiry / CVC never reach BountyExpo
infrastructure.

```
┌──────────────────────┐     HTTPS/TLS1.2+      ┌─────────────────────────┐
│  BountyExpo mobile   │  ───────────────────►  │  Stripe (PCI DSS L1)    │
│  React Native app    │    PAN / exp / CVC     │  api.stripe.com         │
│                      │  (handled by Stripe    │  js.stripe.com          │
│  • stripe-react-     │   SDK, never exposed   │                         │
│    native SDK        │   to our JS bridge)    │  • Tokenization         │
│  • Payment Element   │                        │  • 3DS / SCA            │
│    WebView (js.      │  ◄───────────────────  │  • Vaulting             │
│    stripe.com)       │     pm_* / seti_*      │                         │
└──────────┬───────────┘       (opaque id)      └────────────┬────────────┘
           │                                                 │
           │ pm_* / seti_* / pi_* (NO CHD)                   │
           │                                                 │  webhook
           ▼                                                 │  (signed)
┌──────────────────────┐                                     ▼
│  BountyExpo backend  │                        ┌─────────────────────────┐
│  (Fastify / Edge Fn) │  ◄───────────────────  │  Webhook events          │
│  services/api        │                        │  (signature verified)    │
│  supabase/functions  │                        └─────────────────────────┘
└──────────────────────┘
```

### Evidence this flow holds

1. **Native SDK path (preferred).** `lib/services/payment-methods-service.ts`
   (`createPaymentMethod`) delegates to
   `stripeSdk.getSDK().createPaymentMethod({ paymentMethodType: 'Card', ... })`
   from `@stripe/stripe-react-native`. The PAN / CVC are collected by the
   Stripe `CardField` component and tokenized inside the SDK; the JS bridge
   only ever sees `paymentMethod.id` and `paymentMethod.Card.last4`.
2. **WebView Payment Element path.** `components/add-card-modal.tsx` with
   `usePaymentElement=true` loads the Stripe.js Payment Element from
   `js.stripe.com`. Card entry happens inside an iframe served by Stripe; our
   WebView receives only a `setup_intent.client_secret` → `pm_...` result.
3. **Connect onboarding.** `components/connect-embedded-webview.tsx` loads
   Stripe-hosted embedded components; bank-account and identity data never
   touch our servers.
4. **Server side — no CHD accepted.** A full repo grep of the server codebase
   for `cardNumber | card_number | cvv | cvc | \bpan\b` returns **zero hits**
   (all matches elsewhere are `conversationParticipants`, OpenTelemetry
   `span`, or HTML `<span>` fragments). Every payment endpoint accepts only
   opaque Stripe IDs — see `services/api/src/routes/payments.ts`, `wallet.ts`,
   `supabase/functions/connect/index.ts`.
5. **Database.** `supabase/migrations/20251102_stripe_payments_integration.sql`
   (`payment_methods` table) stores only `stripe_payment_method_id`,
   `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year`. No PAN / CVC
   columns exist, and the schema has a PCI-safe design documented in
   `docs/payments/SUPABASE_STRIPE_INTEGRATION.md`.
6. **Logs.** Logging policy forbids dumping request bodies for payment routes.
   `lib/utils/error-logger.ts` and server loggers redact Stripe objects to
   their `id` and `status` fields. This is called out in
   `docs/security/PAYMENT_SECURITY_COMPLIANCE.md` §Requirement 3.

## 4. SAQ A Questionnaire Responses

The official SAQ A (v4.0) contains requirements under four headings. Each
response below is either **In Place** (`✅`), **Not Applicable** (`N/A`), or
**In Place with CCW** (compensating control). No answer may be "Not in Place"
before submission.

### Requirement 2 — System configuration

| Ref | Control | Response | Evidence |
|-----|---------|----------|----------|
| 2.1.2 | Roles & responsibilities for Requirement 2 activities are documented, assigned, and understood. | ✅ In Place | This document; DRI: Payments Lead |
| 2.2.7 | All non-console administrative access is encrypted using strong cryptography. | N/A | No CDE systems under SAQ A; Stripe Dashboard MFA + TLS1.2+ is enforced by Stripe |
| 2.3.1 | Wireless vendor defaults are changed. | N/A | No wireless networks in CDE |

### Requirement 6 — Develop and maintain secure systems and software

| Ref | Control | Response | Evidence |
|-----|---------|----------|----------|
| 6.3.3 | All system components are protected from known vulnerabilities by installing applicable security patches/updates within one month of release. | ✅ In Place | Dependabot configured; `.github/dependabot.yml`; `npm audit` in CI |
| 6.4.3 | All payment-page scripts that are loaded and executed in the consumer's browser are managed: (a) method is implemented to confirm each script is authorized; (b) integrity is assured; (c) an inventory is maintained. | ✅ In Place | Only Stripe scripts (`js.stripe.com/v3`) are loaded in the WebView; no third-party tag managers inject into payment pages |
| 6.4.1 | Public-facing web apps are reviewed annually or when changed. | ✅ In Place | `docs/security/SECURITY_AUDIT_REPORT.md` |

### Requirement 8 — Identify users and authenticate access

| Ref | Control | Response | Evidence |
|-----|---------|----------|----------|
| 8.3.1 | All user access to system components for users and administrators is authenticated via strong authentication. | ✅ In Place | Stripe Dashboard enforces MFA for all team members; Supabase admin uses SSO+MFA |
| 8.3.3 | User identity is verified before modifying any authentication factor. | ✅ In Place | Stripe + Supabase built-in |

### Requirement 9 — Restrict physical access

All 9.x controls are **N/A** — BountyExpo has no physical CDE (Stripe operates
the physical CDE; no paper card records are retained on premises).

### Requirement 12 — Support information security with policies and programs

| Ref | Control | Response | Evidence |
|-----|---------|----------|----------|
| 12.1.1 | An overall information security policy is established, published, maintained, and disseminated to all relevant personnel. | ✅ In Place | `docs/security/SECURITY.md` |
| 12.8.1 | A list of all third-party service providers (TPSPs) with which account data is shared, or that could affect the security of account data, is maintained. | ✅ In Place | TPSP = Stripe (payments), Supabase (database/auth/edge functions, no CHD), Vercel/Fly (hosting, no CHD), Expo (build, no CHD). See `docs/security/TPSP_INVENTORY.md` §TPSP Inventory below if absent — update before launch. |
| 12.8.2 | Written agreements with TPSPs are maintained. | ✅ In Place | Stripe Services Agreement, Supabase SLA |
| 12.8.4 | A program is implemented to monitor TPSPs' PCI DSS compliance status annually. | ✅ In Place | Annual review of Stripe AoC; reminder on engineering calendar (Q1) |
| 12.8.5 | Information is maintained about which PCI DSS requirements are managed by each TPSP, which are managed by the entity, and any that are shared. | ✅ In Place | §2 of this document |
| 12.10.1 | An incident response plan exists and is ready to be activated in the event of a suspected or confirmed security incident. | ✅ In Place | `docs/security/PAYMENT_SECURITY_COMPLIANCE.md` §Incident Response |

### Appendix A2 — SSL/early-TLS

| Ref | Control | Response | Evidence |
|-----|---------|----------|----------|
| A2.1 | SSL and early TLS are not used as a security control. | ✅ In Place | All outbound Stripe / Supabase traffic uses TLS 1.2+. `docs/security/HTTPS_ENFORCEMENT_SUMMARY.md` |

## 5. Compliance Posture Summary

| Dimension | State |
|-----------|-------|
| SAQ type | **A** (fully outsourced card handling) |
| Merchant level | **4** |
| CHD in our systems | **None** (verified by code audit) |
| Tokenization vendor | **Stripe** (PCI DSS L1) |
| Questionnaire submitted | ⏳ Pending — must be completed in the Stripe Dashboard before public launch |
| Compliance contact | Payments Lead (see `docs/security/SECURITY.md`) |
| Last review | 2026-04-24 |
| Next review | 2027-04-24 (annual) or on any change that could expand PCI scope |

## 6. Guardrails to Preserve SAQ-A Scope

The following changes would **break SAQ-A eligibility** and must trigger a
compliance re-evaluation **before** merge:

- ❌ Adding any server endpoint that accepts a raw PAN, CVV, expiry, or
  magnetic-stripe data in its request body.
- ❌ Storing any card data in our own database (beyond `card_brand`, `last4`,
  `exp_month`, `exp_year` for display).
- ❌ Proxying card data through our own backend to reach Stripe (always use
  the Stripe SDK client-side or Stripe-hosted pages).
- ❌ Writing our own card form and POSTing card details to a custom endpoint,
  even if that endpoint "just forwards to Stripe" — this is exactly what
  SAQ A-EP exists for and dramatically expands scope.
- ❌ Logging or emitting card details in analytics / Sentry / Mixpanel.
- ❌ Removing Stripe's `CardField` / Payment Element in favor of a
  third-party card-capture library that isn't PCI-validated.

The CI / code-review checklist in `docs/security/PAYMENT_SECURITY_COMPLIANCE.md`
encodes these rules. Treat any PR that touches card capture as requiring an
explicit sign-off from the Payments Lead.

## 7. Action Items Before Public Launch

1. **Complete the Stripe SAQ-A questionnaire.** Log into the Stripe Dashboard,
   navigate to *Compliance → Start Questionnaire*, select SAQ A, and answer
   each question using the evidence in §4. Stripe auto-populates the
   TPSP-delegated portions.
2. **Sign the Attestation of Compliance (AoC).** Produced automatically once
   the questionnaire is complete; an authorized officer (CEO / CTO / CISO)
   must sign.
3. **Store the signed AoC** in the BountyExpo company secure drive (not in
   this repository).
4. **Schedule the annual recertification reminder** on the engineering
   calendar for 12 months after submission.
5. **Update this document** with the submission date and AoC reference once
   signed.

## References

- Stripe — [Shared Responsibility Model](https://stripe.com/docs/security/guide#shared-responsibilities)
- Stripe — [PCI Compliance Guide](https://stripe.com/guides/pci-compliance)
- Stripe — [Attestation of Compliance](https://stripe.com/files/PCI-DSS-AOC.pdf)
- PCI SSC — [SAQ A v4.0](https://www.pcisecuritystandards.org/document_library/)
- Internal — [`PAYMENT_SECURITY_COMPLIANCE.md`](./PAYMENT_SECURITY_COMPLIANCE.md)
- Internal — [`PAYMENT_INTEGRATION_SECURITY_GUIDE.md`](./PAYMENT_INTEGRATION_SECURITY_GUIDE.md)
- Internal — [`SUPABASE_STRIPE_INTEGRATION.md`](../payments/SUPABASE_STRIPE_INTEGRATION.md)
