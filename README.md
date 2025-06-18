# Global Payments HPP / REST Sample Server

A lightweight Express.js backend that demonstrates how to integrate **Global Payments (Realex)** Hosted Payment Page (HPP) and REST APIs. It exposes JSON endpoints for creating HPP sessions, looking up transactions, issuing refunds, and more. The server also spins up an **ngrok** tunnel so you can test end-to-end flows from any device.

---

## Features

* **Create Session** – Generates the signed payload required for the Global Payments HPP.
* **Transaction Lookup** – Queries an order via the REST API.
* **Refund & Void** – XML-based rebate/void requests with SHA-1 signatures.
* **Automatic Logging** – All activity is written to `./data/transactions.json`.
* **ngrok Support** – Public HTTPS URL for local testing.
* **Static Front-End** – Anything in `/public` is served automatically.

---

## Folder Structure

```
.
├── rest-server.js        # ← The server described in this README
├── public/               # Optional front-end assets (HTML, JS, CSS)
├── data/
│   ├── transactions.json # Rolling log created at runtime
│   └── logs/             # Saved XML/REST payloads (via /api/gp/save-log)
└── .env                  # Your private credentials (never commit!)
```

---

## Prerequisites

| Tool | Minimum Version | Notes |
|------|-----------------|-------|
| Node.js | 18 LTS | Uses ES modules & async functions |
| npm or yarn | latest | Only runtime deps: **express**, **axios**, **cors**, **dotenv**, **ngrok** |
| A Global Payments (Realex) account | — | Credentials for test or live environment |
| NGROK account is required | - | https://ngrok.com |

---

## Environment Variables (`.env`)

```dotenv
# Required – your merchant credentials
GP_MERCHANT_ID=your_merchant_id
GP_ACCOUNT=internet
GP_SHARED_SECRET=super_secret_hash
GP_ENV=live   # or sandbox

# Required for REST calls & transaction lookup
GP_API_KEY=your_rest_api_key
GP_BASE_URL=https://api.globalpay.com/gp

# Optional
PORT=4242   # Defaults to 4242 if omitted
```

> **Tip:** Never commit `.env` – add it to `.gitignore`.

---

## Installation & Run

```bash
# 1. Clone the repo

# 2. Install deps
$ npm install    # or yarn

# 3. Create .env with the vars above
$ cp .env.example .env
$ nano .env      # fill in your creds

# 4. Start the server
$ node rest-server.js

# 5. Note the ngrok URL in the console – that’s your public callback base.
```

Once running you’ll see something like:

```
✅ REST server running on http://localhost:4242
⏳ ngrok status: connected
🌍 Public URL via ngrok: https://ab12-34-56-78-90.ngrok-free.app
```

---

## API Reference

All endpoints are prefixed with `/api/gp/`.

### 1. Create Session

```
POST /api/gp/create-session
{
  "amount": "4999",     // optional – default 4999
  "currency": "EUR"      // optional – default EUR
}
```
Response
```json
{
  "MERCHANT_ID": "...",
  "ORDER_ID": "order1678892340000",
  "SHA1HASH": "...",
  "MERCHANT_RESPONSE_URL": "https://<ngrok>/return.html",
  ...etc
}
```
Embed the JSON in your HPP form or redirect script.

---

### 2. Transaction Lookup (REST)

```
POST /api/gp/get-transaction
{
  "orderId": "order1678892340000"
}
```
Server forwards the call to `GET {GP_BASE_URL}/v1/{MERCHANT_ID}/orders/{orderId}` and returns the REST payload.

---

### 3. Refund (XML rebate)

```
POST /api/gp/refund
{
  "orderId":   "order1678892340000",
  "pasref":    "123456789",
  "authcode":  "A1B2C3",
  "amount":    "4999",
  "currency":  "EUR"
}
```
Returns raw XML - useful for debugging.

---

### 4. Void

```
POST /api/gp/void
{
  "orderId": "order1678892340000",
  "pasref":  "123456789"
}
```
---

### 5. Capture

```
POST /api/gp/capture   # => 400 – Not supported in HPP auto-settle mode
```
---

### 6. All Transactions (local log)

```
GET /api/gp/all-transactions
```
Returns the content of `./data/transactions.json`.

---

### 7. Save Log

```
POST /api/gp/save-log
{
  "log": "…XML or JSON…"
}
```
Server writes the payload to `./data/logs/realex-log-<timestamp>.txt`.

---

## Front-End Callback Pages

`return.html` and `fail.html` inside the `/public` folder receive the HPP redirect. Edit them to suit your UI.

---

## Development Tips

* **Hot reload** – use [`nodemon`](https://github.com/remy/nodemon) for auto-restart.
* **Testing** – pair with [ngrok inspect](https://ngrok.com/docs/inspect) to replay callbacks.
* **Currency / amount** – values must be **minor units** (e.g. €50.00 → `5000`).
* **SHA-1 deprecation** – Global Payments still requires SHA-1 for legacy flows; don’t reuse this pattern elsewhere.

---

## Security Notes

* Keep `GP_SHARED_SECRET` & `GP_API_KEY` out of source control.
* Limit `GP_API_KEY` to the lowest scope needed.
* Use HTTPS in production – ngrok is just for demos.

---

## License

MIT – do whatever you want, but **no warranty**. See `LICENSE` file.
