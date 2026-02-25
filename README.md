# EntornoSeguro - Stage 1 (v2.1)

Stage 1 delivers a demo-first phishing simulation SaaS flow in sandbox mode:

- signup tenant
- setup target/sending domains
- import employees from CSV
- create campaign draft
- preview campaign + training
- load demo-only employee timeline

No real sending is performed in Stage 1.

## Repo Structure

- `apps/api`: Fastify API for Stage 1 business flow
- `apps/web`: Next.js demo UI
- `packages/shared`: shared schemas, types, pause precedence logic
- `packages/db`: JSON persistence layer and data models

## Stage 1 Scope Freeze Implemented

- exactly one `TargetDomain` per tenant
- dedicated mode uses per-tenant subdomain (`<tenant-slug>.sim.<platform-domain>`)
- pause precedence: `global > tenant > campaign`
- roles: `owner/admin`
- `customer_domain`: model + states + stub verification flow
- sandbox default and demo-only data for previews/timeline

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

### Web

- `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`)

## Notes

- `open rate` is intentionally not a primary KPI in Stage 1.
- Pause controls block new scheduling/send actions and do not block timeline/event style read paths.
- This implementation is intentionally lean and demo-oriented for founder-led pilots.
