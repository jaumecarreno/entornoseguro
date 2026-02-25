# EntornoSeguro - Stage 3 (v2.1)

Stage 3 keeps the Stage 2 execution flow and adds conservative hardening:

- signup tenant
- setup target/sending domains
- import employees from CSV
- create campaign draft
- preview campaign + training
- schedule + dispatch campaign recipients
- ingest provider webhook events with idempotency and deduplication
- run employee events (`click`, `report`, `credential_submit_simulated`)
- start + complete training session with quiz attempt
- load employee timeline/history with recorded events
- compute explainable risk overview on demand
- evaluate campaign risk with conservative thresholds
- review policy violations manually before restricting a tenant

Delivery remains mock-provider based by default for safe pilot execution.

## Repo Structure

- `apps/api`: Fastify API for Stage 3 business flow
- `apps/web`: Next.js demo UI
- `packages/shared`: shared schemas, types, pause precedence logic
- `packages/db`: JSON persistence layer and data models

## Scope Freeze Implemented

- exactly one `TargetDomain` per tenant
- dedicated mode uses per-tenant subdomain (`<tenant-slug>.sim.<platform-domain>`)
- pause precedence: `global > tenant > campaign`
- roles: `owner/admin`
- `customer_domain`: model + states + stub verification flow
- sandbox default and demo-only data support where applicable

## Commands

```bash
npm install
npm run lint
npm run test
npm run build
npm run dev
```

API: `http://localhost:4000`
Web: `http://localhost:3000`

## Environment Variables

### API

- `PORT` (default `4000`)
- `HOST` (default `0.0.0.0`)
- `DB_FILE` (default `./data/stage1-db.json`)
- `PLATFORM_SIM_DOMAIN` (default `sim.entornoseguro.local`)
- `EMAIL_PROVIDER_KIND` (default `mock`)

### Web

- `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`)

## Notes

- Open rate is secondary and not a primary KPI signal.
- Pause controls block new scheduling/send actions and do not block webhook/event ingestion.
- Credential submit simulation never persists password values in storage.
- JSON storage is intentionally lean for pilots and demo scenarios.
- Manual restriction is never automatic: a policy violation must be reviewed and approved first.
