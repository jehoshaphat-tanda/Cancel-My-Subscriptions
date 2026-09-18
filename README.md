# Subscription Killer Proxy

A local-first Next.js and FastAPI application for reviewing recurring subscriptions, matching merchant accounts, and generating cancellation notices.

## Current scope

- In-memory CSV/PDF parsing and pasted transaction parsing through FastAPI.
- Regex-based recurring charge detection with confidence scoring.
- Per-merchant selection and estimated monthly savings.
- Per-merchant account email or customer ID collection.
- Drawn signature capture and PDF notice generation.
- Downloadable itemized receipts with no financial data persistence.

Plaid, authentication, qualified e-signature, verified merchant endpoints, and audit storage are intentionally not connected yet.

## Install and run locally

Requires Node.js 20+, npm, and Python 3.11+.

```powershell
npm install

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Start the API in one terminal:

```powershell
uvicorn backend.main:app --reload --port 8000
```

Start Next.js in another terminal:

```powershell
npm run dev
```

Open http://localhost:3000.

## Security boundary

The API does not write statements, PDFs, signatures, transaction records, or account identifiers to disk or a database. Hosting and reverse-proxy request-body logs must be disabled or redacted before processing real financial data. The current application generates and downloads notices; it does not automatically contact merchants. Automatic delivery requires a verified merchant directory, endpoint-specific authorization, provider credentials, retry limits, and legal review.
