# TIMB3R Phase 2

This package expands the starter into an investor dashboard and transaction/investment backend.

## Included
- Investor dashboard
- Investment plans
- Portfolio
- Transaction history
- Profile/KYC status
- Referral code generation
- Admin users/transactions/audit endpoints
- Investment creation with server-side balance checks
- PostgreSQL schema for users, plans, investments, transactions, KYC documents and audit logs
- Demo-only deposit flow
- Placeholder payment webhook that refuses live money movement until a real provider contract is implemented

## Run
1. Node.js 20+
2. PostgreSQL
3. Run `sql/schema.sql`
4. Copy `.env.example` to `.env`
5. Set `DATABASE_URL` and a strong `JWT_SECRET`
6. `npm install`
7. `npm start`

## Production checklist
Before accepting real public investments:
- select a compliant payment provider;
- verify signed webhooks server-side;
- make provider references idempotent;
- implement a proper double-entry ledger/reconciliation process;
- implement withdrawal controls;
- implement secure KYC document storage and review;
- add rate limiting, CSRF/session strategy where applicable, monitoring and backups;
- complete legal/regulatory review for the exact investment structure.

GoDaddy Node.js Hosting provides preview and publish variants; source uploads land in preview and publishing promotes preview to production. Deployments can be listed and rolled back. See GoDaddy's current Node.js Hosting documentation.
