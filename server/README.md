# BountyExpo Stripe Payment Server

Minimal Node.js/Express server for handling Stripe payment operations for the BountyExpo mobile app.

## Features

- **Payment Intent Creation**: Create Stripe PaymentIntents for adding money to wallets
- **Webhook Handling**: Secure webhook endpoint for Stripe events with signature verification
- **Connect Onboarding**: Scaffold endpoints for Stripe Connect account linking (for withdrawals)
- **Transaction Logging**: Local JSON file persistence for demo purposes

## Prerequisites

- Node.js 16+ installed
- Stripe account with API keys
- Stripe CLI (optional, for local webhook testing)

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` and fill in your Stripe credentials:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set:
   - `STRIPE_SECRET_KEY`: Your Stripe secret key from https://dashboard.stripe.com/apikeys
   - `STRIPE_PUBLISHABLE_KEY`: Your Stripe publishable key (for reference)
   - `STRIPE_WEBHOOK_SECRET`: Your webhook signing secret (see Webhook Setup below)
   - `PORT`: Port to run the server on (default: 3001)

3. **Start the server**:
   ```bash
   npm start
   ```

   The server will start on `http://localhost:3001`

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and configuration check.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "stripeConfigured": true
}
```

### Create Payment Intent
```
POST /payments/create-payment-intent
Content-Type: application/json

{
  "amountCents": 5000,
  "currency": "usd",
  "metadata": {
    "userId": "user_123",
    "purpose": "wallet_deposit"
  }
}
```

**Response**:
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

### Stripe Webhook
```
POST /webhooks/stripe
Content-Type: application/json
Stripe-Signature: t=xxx,v1=xxx
```

Handles Stripe webhook events. Requires valid signature verification.

**Supported Events**:
- `payment_intent.succeeded`: Logs successful payment
- `charge.refunded`: Logs refund transaction

### Create Connect Account Link (Scaffold)
```
POST /connect/create-account-link
Content-Type: application/json

{
  "userId": "user_123",
  "email": "user@example.com"
}
```

**Response** (Mock):
```json
{
  "url": "https://connect.stripe.com/setup/c/...",
  "accountId": "acct_xxx",
  "expiresAt": 1234567890000,
  "message": "This is a mock response..."
}
```

### Initiate Transfer (Scaffold)
```
POST /connect/transfer
Content-Type: application/json

{
  "accountId": "acct_xxx",
  "amount": 5000,
  "currency": "usd",
  "metadata": {}
}
```

**Response** (Mock):
```json
{
  "transferId": "tr_xxx",
  "status": "pending",
  "amount": 5000,
  "currency": "usd",
  "accountId": "acct_xxx",
  "estimatedArrival": "2024-01-04T00:00:00.000Z",
  "message": "Transfer initiated..."
}
```

## Webhook Setup

### Option 1: Local Testing with Stripe CLI

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli

2. Login to Stripe:
   ```bash
   stripe login
   ```

3. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:3001/webhooks/stripe
   ```

4. Copy the webhook signing secret from the CLI output and add it to your `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

5. Test webhook delivery:
   ```bash
   stripe trigger payment_intent.succeeded
   ```

### Option 2: Production Webhook Setup

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Set URL to: `https://your-domain.com/webhooks/stripe`
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `charge.refunded`
5. Copy the signing secret and add to your production `.env`

## Transaction Logging

Webhook events are logged to `wallet-transactions.json` in the server directory. This is for **demo purposes only**.

For production:
- Replace file-based storage with a proper database
- Implement proper transaction tracking
- Add authentication and authorization
- Add rate limiting and security measures

## Security Considerations

⚠️ **Important**: This server implements production-grade security measures.

### HTTPS Enforcement (CWE-319 Protection)

**Production Mode**: When `NODE_ENV=production`, the server automatically:
- ✅ **Rejects all HTTP requests** with 403 Forbidden
- ✅ **Enforces HTTPS-only connections** (prevents cleartext transmission)
- ✅ **Adds HSTS header** (Strict-Transport-Security: max-age=31536000)
- ✅ **Adds security headers** (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- ✅ **Supports reverse proxy** (detects X-Forwarded-Proto header)

**Development Mode**: HTTPS enforcement is disabled for local development convenience.

### Production Deployment Options

#### Option A: Reverse Proxy (Recommended)
Deploy behind a reverse proxy that handles SSL/TLS termination:
- **Nginx**: Configure with SSL certificates and set `proxy_set_header X-Forwarded-Proto $scheme;`
- **Apache**: Use mod_proxy with SSL and `RequestHeader set X-Forwarded-Proto "https"`
- **Cloudflare**: Automatically handles HTTPS and sets X-Forwarded-Proto
- **AWS ALB/ELB**: Configure with SSL certificate and X-Forwarded-Proto

Example nginx configuration:
```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}
```

#### Option B: Direct HTTPS (Advanced)
For direct HTTPS without a reverse proxy, the server would need modifications to use the `https` module with SSL certificates.

### Additional Security Measures

For production deployment:
- ✅ **Authentication**: JWT token validation via Supabase (implemented)
- ✅ **Rate limiting**: Prevents abuse (implemented)
- ✅ **Input sanitization**: XSS and injection protection (implemented)
- ✅ **CORS**: Configurable allowed origins (implemented)
- ✅ **HTTPS enforcement**: Rejects insecure connections (implemented)
- ⚠️ **Database security**: Store data in a secure database, not JSON files
- ⚠️ **Logging**: Add comprehensive security logging and monitoring
- ⚠️ **Updates**: Keep dependencies updated regularly
- ⚠️ **Stripe best practices**: Follow all Stripe security guidelines

### Security Headers Explained

When running in production, these headers protect against common attacks:
- **Strict-Transport-Security (HSTS)**: Forces browsers to use HTTPS for 1 year
- **X-Content-Type-Options**: Prevents MIME-type sniffing attacks
- **X-Frame-Options**: Prevents clickjacking attacks
- **X-XSS-Protection**: Enables browser XSS filtering

## Troubleshooting

### Server won't start
- Check that port 3001 is not already in use
- Verify `.env` file exists and is properly formatted
- Check Node.js version (16+ required)

### Webhook signature verification fails
- Ensure `STRIPE_WEBHOOK_SECRET` matches your Stripe webhook endpoint
- For local testing, use Stripe CLI forwarding
- Check that request body is not being parsed before verification

### Payment intent creation fails
- Verify `STRIPE_SECRET_KEY` is correct and active
- Check Stripe Dashboard for any account issues
- Ensure amount is a positive integer in cents

## Development

To run in development mode with auto-reload:
```bash
npm run dev
```

## License

MIT
