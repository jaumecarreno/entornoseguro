# Stage 3 Runbook (Risk + Manual Enforcement)

## Happy Path Demo

1. Sign up tenant from web app.
2. Create one target domain and mark as `demo_verified`.
3. Review dedicated sending domain generated for tenant.
4. Optionally create customer sending domain and mark `stub_verified`.
5. Import employees via CSV.
6. Create campaign draft with selected `sending_mode` and sending domain.
7. Run campaign preview and then schedule campaign.
8. Dispatch campaign recipients (`POST /campaigns/:id/dispatch`).
9. Track behavior using event endpoints or provider webhooks.
10. Start and complete training, then review employee timeline/history.

## Stage 2 Core Endpoints

- Dispatch recipients: `POST /campaigns/:id/dispatch`
- Campaign recipients: `GET /campaigns/:id/recipients`
- Webhook ingest: `POST /webhooks/email-provider`
- Event click: `POST /events/click`
- Event report: `POST /events/report-phish`
- Credential submit simulated: `POST /events/credential-submit-simulated`
- Training start: `POST /training/start`
- Training complete: `POST /training/:sessionId/complete`
- Employee timeline: `GET /employees/:id/timeline?scope=all`
- Employee history: `GET /employees/:id/history`

## Stage 3 Endpoints

- Risk overview (explainable): `GET /risk/overview`
- Evaluate campaign risk: `POST /campaigns/:id/evaluate-risk`
- List policy violations: `GET /ops/policy-violations`
- Review policy violation: `POST /ops/policy-violations/:id/review`
- Restrict/unrestrict tenant (manual): `POST /ops/tenants/:id/restrict`

## Pause Controls

- Global pause: `POST /ops/pause-global`
- Tenant pause: `POST /ops/tenants/:id/pause`
- Campaign pause: `POST /campaigns/:id/pause`

Precedence check for schedule/dispatch:

1. `global`
2. `tenant`
3. `campaign`

## Security/Anti-abuse in Stage 3

- One target domain per tenant (MVP freeze)
- Separate target/sending domain model
- `customer_domain` remains stub-gated in MVP (`stub_verified` required)
- Owner/admin-only access model for individual employee timeline/history
- Webhook idempotency via processed event ids
- Event deduplication at recipient-event level
- Credential submit simulation stores only safe metadata (`username`, `hasPasswordInput`)
- Conservative policy thresholds and non-automatic enforcement
- Manual review required before tenant restriction

## Known Stage 3 Limits

- Email provider defaults to mock adapter (`EMAIL_PROVIDER_KIND=mock`)
- Customer domain DNS verification is still stubbed
- JSON storage is suitable for pilot/demo, not production scale
- Restriction is manual only (no automatic suspension engine)
