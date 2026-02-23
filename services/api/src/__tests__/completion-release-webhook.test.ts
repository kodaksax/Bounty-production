/**
 * Unit tests for the /webhook endpoint in the completion-release router.
 * Validates Stripe webhook signature verification logic added in the PR.
 */

import { Router, Request, Response } from 'express';

// ── Mocks set up before any module imports ─────────────────────────────────

const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

const mockProcessCompletionRelease = jest.fn();
jest.mock('../services/completion-release-service', () => ({
  completionReleaseService: {
    processCompletionRelease: mockProcessCompletionRelease,
    isAlreadyReleased: jest.fn().mockResolvedValue(false),
    getReleaseTransaction: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/idempotency-service', () => ({
  checkIdempotencyKey: jest.fn().mockResolvedValue(false),
  storeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
  removeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
}));

// ── Helper: build a minimal mock req/res pair ──────────────────────────────

function makeReqRes(opts: {
  headers?: Record<string, string | string[] | undefined>;
  body?: any;
  rawBody?: any;
}) {
  const req: Partial<Request> & { rawBody?: any } = {
    headers: (opts.headers ?? {}) as any,
    body: opts.body ?? Buffer.from('{}'),
    rawBody: opts.rawBody,
  };

  const res: any = {
    _status: 200,
    _body: undefined as any,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: any) {
      this._body = body;
      return this;
    },
  };

  return { req: req as Request, res: res as Response };
}

// ── Import router AFTER mocks are set up ──────────────────────────────────

// Environment variables must be set before the module is required so the
// module-scoped Stripe singleton is initialised with a key.
const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
});

afterAll(() => {
  if (ORIGINAL_STRIPE_SECRET_KEY !== undefined) {
    process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY;
  } else {
    delete process.env.STRIPE_SECRET_KEY;
  }
  if (ORIGINAL_STRIPE_WEBHOOK_SECRET !== undefined) {
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_STRIPE_WEBHOOK_SECRET;
  } else {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

// Use require so environment vars are in place before the module initialises
// its module-scoped `stripe` singleton.
const { completionReleaseRouter } = require('../routes/completion-release');

// ── Find the /webhook handler on the router ────────────────────────────────

function getWebhookHandler(router: Router) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/webhook' && l.route?.methods?.post,
  );
  if (!layer) throw new Error('/webhook POST handler not found on router');
  return layer.route.stack[0].handle as (req: Request, res: Response) => Promise<void>;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('completionReleaseRouter POST /webhook', () => {
  let webhookHandler: (req: Request, res: Response) => Promise<void>;

  beforeAll(() => {
    webhookHandler = getWebhookHandler(completionReleaseRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('missing or invalid stripe-signature header', () => {
    it('returns 400 when stripe-signature header is absent', async () => {
      const { req, res } = makeReqRes({ body: Buffer.from('{}') });
      await webhookHandler(req, res as any);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/stripe-signature/i);
    });

    it('returns 400 when stripe-signature is an array', async () => {
      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': ['sig1', 'sig2'] },
        body: Buffer.from('{}'),
      });
      await webhookHandler(req, res as any);
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/stripe-signature/i);
    });
  });

  describe('raw body validation', () => {
    it('returns 500 when body is a plain object (not string or Buffer)', async () => {
      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'valid_sig' },
        body: { type: 'payment_intent.succeeded' }, // parsed JSON object
      });
      await webhookHandler(req, res as any);
      expect(res._status).toBe(500);
      expect(res._body.error).toMatch(/raw format/i);
    });
  });

  describe('signature verification', () => {
    it('returns 400 with a generic message when constructEvent throws', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'bad_sig' },
        body: Buffer.from('{"type":"payment_intent.succeeded"}'),
      });
      await webhookHandler(req, res as any);

      expect(res._status).toBe(400);
      // Generic message — no internal detail leaked
      expect(res._body.error).toBe('Webhook signature verification failed');
      // Internal detail must NOT appear in the response
      expect(JSON.stringify(res._body)).not.toContain('No signatures found');
    });

    it('does not invoke business logic when signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Signature mismatch');
      });

      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'bad_sig' },
        body: Buffer.from('{"type":"payment_intent.succeeded"}'),
      });
      await webhookHandler(req, res as any);

      expect(mockProcessCompletionRelease).not.toHaveBeenCalled();
    });
  });

  describe('successful verification', () => {
    it('returns 200 and { received: true } for a verified non-payment event', async () => {
      mockConstructEvent.mockReturnValue({ type: 'charge.succeeded', id: 'evt_123', data: { object: {} } });

      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from('{"type":"charge.succeeded"}'),
      });
      await webhookHandler(req, res as any);

      expect(res._status).toBe(200);
      expect(res._body).toEqual({ received: true });
    });

    it('triggers processCompletionRelease for payment_intent.succeeded with metadata', async () => {
      const fakeEvent = {
        type: 'payment_intent.succeeded',
        id: 'evt_456',
        data: {
          object: {
            id: 'pi_test123',
            metadata: { bounty_id: 'bounty_abc', hunter_id: 'hunter_xyz' },
          },
        },
      };
      mockConstructEvent.mockReturnValue(fakeEvent);
      mockProcessCompletionRelease.mockResolvedValue({ success: true });

      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from(JSON.stringify(fakeEvent)),
      });
      await webhookHandler(req, res as any);

      expect(mockProcessCompletionRelease).toHaveBeenCalledWith({
        bountyId: 'bounty_abc',
        hunterId: 'hunter_xyz',
        paymentIntentId: 'pi_test123',
      });
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ received: true });
    });

    it('still returns 200 when payment_intent.succeeded lacks bounty metadata', async () => {
      const fakeEvent = {
        type: 'payment_intent.succeeded',
        id: 'evt_789',
        data: {
          object: {
            id: 'pi_no_meta',
            metadata: {},
          },
        },
      };
      mockConstructEvent.mockReturnValue(fakeEvent);

      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'valid_sig' },
        body: Buffer.from(JSON.stringify(fakeEvent)),
      });
      await webhookHandler(req, res as any);

      expect(mockProcessCompletionRelease).not.toHaveBeenCalled();
      expect(res._status).toBe(200);
    });

    it('accepts a string rawBody via req.rawBody', async () => {
      const fakeEvent = { type: 'charge.updated', id: 'evt_raw', data: { object: {} } };
      mockConstructEvent.mockReturnValue(fakeEvent);

      const rawString = JSON.stringify(fakeEvent);
      const { req, res } = makeReqRes({
        headers: { 'stripe-signature': 'valid_sig' },
        rawBody: rawString, // string, not Buffer
      });
      await webhookHandler(req, res as any);

      expect(mockConstructEvent).toHaveBeenCalledWith(rawString, 'valid_sig', 'whsec_test_secret');
      expect(res._status).toBe(200);
    });
  });
});
