import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

let app: Awaited<ReturnType<typeof createApp>>;

async function signup() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/signup-tenant",
    payload: {
      companyName: "Acme Security",
      adminEmail: "owner@acme.test",
      defaultSendingMode: "dedicated",
    },
  });

  expect(response.statusCode).toBe(201);
  return response.json() as {
    token: string;
    tenant: { id: string; slug: string };
    admin: { id: string };
  };
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("stage1 api", () => {
  beforeEach(async () => {
    const dbFilePath = path.join(os.tmpdir(), `entornoseguro-${randomUUID()}.json`);
    app = await createApp({ dbFilePath, platformSimDomain: "sim.example.com", logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates tenant with dedicated subdomain and returns /me", async () => {
    const signupPayload = await signup();

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(signupPayload.token),
    });

    expect(me.statusCode).toBe(200);
    const body = me.json() as {
      tenant: { slug: string; lifecycleMode: string };
      sendingDomains: Array<{ mode: string; domain: string }>;
    };

    expect(body.tenant.lifecycleMode).toBe("sandbox");
    expect(body.sendingDomains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "dedicated",
          domain: `${signupPayload.tenant.slug}.sim.example.com`,
        }),
      ]),
    );
  });

  it("enforces one target domain per tenant", async () => {
    const signupPayload = await signup();

    const first = await app.inject({
      method: "POST",
      url: "/target-domains",
      headers: authHeader(signupPayload.token),
      payload: { domain: "acme.test" },
    });

    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/target-domains",
      headers: authHeader(signupPayload.token),
      payload: { domain: "second.test" },
    });

    expect(second.statusCode).toBe(409);
  });

  it("applies pause precedence global > tenant > campaign when scheduling", async () => {
    const signupPayload = await signup();

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(signupPayload.token),
    });
    const meBody = me.json() as { sendingDomains: Array<{ id: string }> };

    const campaign = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: authHeader(signupPayload.token),
      payload: {
        name: "Q1 Simulation",
        templateName: "Urgent Invoice",
        sendingMode: "dedicated",
        sendingDomainId: meBody.sendingDomains[0].id,
      },
    });
    expect(campaign.statusCode).toBe(201);
    const campaignBody = campaign.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/preview`,
      headers: authHeader(signupPayload.token),
    });

    await app.inject({
      method: "POST",
      url: "/ops/pause-global",
      headers: authHeader(signupPayload.token),
      payload: { paused: true, reason: "maintenance" },
    });

    const blockedGlobal = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });

    expect(blockedGlobal.statusCode).toBe(409);
    expect(blockedGlobal.json()).toMatchObject({ error: "PAUSED_GLOBAL" });

    await app.inject({
      method: "POST",
      url: "/ops/pause-global",
      headers: authHeader(signupPayload.token),
      payload: { paused: false, reason: "maintenance complete" },
    });

    await app.inject({
      method: "POST",
      url: `/ops/tenants/${signupPayload.tenant.id}/pause`,
      headers: authHeader(signupPayload.token),
      payload: { paused: true, reason: "tenant pause" },
    });

    const blockedTenant = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });

    expect(blockedTenant.statusCode).toBe(409);
    expect(blockedTenant.json()).toMatchObject({ error: "PAUSED_TENANT" });

    await app.inject({
      method: "POST",
      url: `/ops/tenants/${signupPayload.tenant.id}/pause`,
      headers: authHeader(signupPayload.token),
      payload: { paused: false, reason: "resume" },
    });

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/pause`,
      headers: authHeader(signupPayload.token),
      payload: { paused: true, reason: "campaign issue" },
    });

    const blockedCampaign = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });

    expect(blockedCampaign.statusCode).toBe(409);
    expect(blockedCampaign.json()).toMatchObject({ error: "PAUSED_CAMPAIGN" });
  });

  it("requires customer_domain to be stub_verified before scheduling", async () => {
    const signupPayload = await signup();

    const createCustomerDomain = await app.inject({
      method: "POST",
      url: "/sending-domains",
      headers: authHeader(signupPayload.token),
      payload: { mode: "customer_domain", domain: "mail.acme.test" },
    });
    expect(createCustomerDomain.statusCode).toBe(201);
    const customerDomain = createCustomerDomain.json() as { id: string };

    const campaign = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: authHeader(signupPayload.token),
      payload: {
        name: "Customer Mode Campaign",
        templateName: "Password Reset",
        sendingMode: "customer_domain",
        sendingDomainId: customerDomain.id,
      },
    });
    expect(campaign.statusCode).toBe(201);
    const campaignBody = campaign.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/preview`,
      headers: authHeader(signupPayload.token),
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: "Customer sending domain must be stub_verified before scheduling" });

    await app.inject({
      method: "POST",
      url: `/sending-domains/${customerDomain.id}/verify-stub`,
      headers: authHeader(signupPayload.token),
    });

    const scheduled = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignBody.id}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });

    expect(scheduled.statusCode).toBe(200);
  });
});
