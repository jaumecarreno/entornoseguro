# Stage 1 Runbook (Demo-Only)

## Happy Path Demo

1. Sign up tenant from web app.
2. Create one target domain and mark as `demo_verified`.
3. Review dedicated sending domain generated for tenant.
4. Optionally create customer sending domain and mark `stub_verified`.
5. Import employees via CSV.
6. Create campaign draft with selected `sending_mode` and sending domain.
7. Run campaign preview + training preview.
8. Load timeline mock for one employee.

## Pause Controls

- Global pause: `POST /ops/pause-global`
- Tenant pause: `POST /ops/tenants/:id/pause`
- Campaign pause: `POST /campaigns/:id/pause`

Precedence check used at scheduling time:

1. `global`
2. `tenant`
3. `campaign`

## Security/Anti-abuse in Stage 1

- One target domain per tenant (MVP freeze)
- Separate target/sending domain model
- `customer_domain` cannot schedule until `stub_verified`
- Owner/admin-only access model
- Audit logs for critical actions

## Known Stage 1 Limits

- No real outbound sending pipeline
- No webhook ingestion pipeline
- Customer domain technical DNS verification is stubbed
- JSON storage is suitable for demo, not production scale
