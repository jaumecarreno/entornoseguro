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

function buildDemoCsv(count: number): string {
  const rows = ["email,full_name,department"];
  for (let i = 0; i < count; i += 1) {
    rows.push(`employee${i}@demo.local,Employee ${i},Ops`);
  }
  return rows.join("\n");
}

async function createReadyCampaign(token: string): Promise<{ campaignId: string; sendingDomainId: string }> {
  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: authHeader(token),
  });
  const meBody = me.json() as { sendingDomains: Array<{ id: string }> };

  const campaign = await app.inject({
    method: "POST",
    url: "/campaigns",
    headers: authHeader(token),
    payload: {
      name: "Q1 Simulation",
      templateName: "Urgent Invoice",
      sendingMode: "dedicated",
      sendingDomainId: meBody.sendingDomains[0].id,
    },
  });
  expect(campaign.statusCode).toBe(201);
  const campaignBody = campaign.json() as { id: string };

  const preview = await app.inject({
    method: "POST",
    url: `/campaigns/${campaignBody.id}/preview`,
    headers: authHeader(token),
  });
  expect(preview.statusCode).toBe(200);

  const schedule = await app.inject({
    method: "POST",
    url: `/campaigns/${campaignBody.id}/schedule`,
    headers: authHeader(token),
    payload: { scheduledAt: new Date().toISOString() },
  });
  expect(schedule.statusCode).toBe(200);

  return { campaignId: campaignBody.id, sendingDomainId: meBody.sendingDomains[0].id };
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

  it("dispatches campaign, records training flow, and never persists password", async () => {
    const signupPayload = await signup();

    await app.inject({
      method: "POST",
      url: "/employees/import-csv",
      headers: authHeader(signupPayload.token),
      payload: {
        csv: "email,full_name,department\nalice@demo.local,Alice Demo,Finance",
      },
    });

    const { campaignId } = await createReadyCampaign(signupPayload.token);

    const dispatch = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/dispatch`,
      headers: authHeader(signupPayload.token),
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);

    const recipients = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/recipients`,
      headers: authHeader(signupPayload.token),
    });
    expect(recipients.statusCode).toBe(200);
    const recipientsBody = recipients.json() as {
      items: Array<{ trackingToken: string; employeeId: string; providerMessageId: string | null }>;
    };
    expect(recipientsBody.items.length).toBeGreaterThan(0);

    const trackingToken = recipientsBody.items[0].trackingToken;

    const click = await app.inject({
      method: "POST",
      url: "/events/click",
      payload: { trackingToken },
    });
    expect(click.statusCode).toBe(200);

    const credential = await app.inject({
      method: "POST",
      url: "/events/credential-submit-simulated",
      headers: authHeader(signupPayload.token),
      payload: {
        trackingToken,
        username: "alice@demo.local",
        password: "TOP_SECRET_DO_NOT_STORE",
      },
    });
    expect(credential.statusCode).toBe(200);
    const credentialBody = credential.json() as { storedMetadata: Record<string, unknown> };
    expect(credentialBody.storedMetadata).toMatchObject({
      username: "alice@demo.local",
      hasPasswordInput: true,
    });
    expect(credentialBody.storedMetadata).not.toHaveProperty("password");

    const startTraining = await app.inject({
      method: "POST",
      url: "/training/start",
      payload: { trackingToken },
    });
    expect(startTraining.statusCode).toBe(200);
    const startBody = startTraining.json() as { sessionId: string };

    const completeTraining = await app.inject({
      method: "POST",
      url: `/training/${startBody.sessionId}/complete`,
      payload: { answers: [0, 1] },
    });
    expect(completeTraining.statusCode).toBe(200);

    const report = await app.inject({
      method: "POST",
      url: "/events/report-phish",
      payload: { trackingToken },
    });
    expect(report.statusCode).toBe(200);

    const timeline = await app.inject({
      method: "GET",
      url: `/employees/${recipientsBody.items[0].employeeId}/timeline?scope=all`,
      headers: authHeader(signupPayload.token),
    });
    expect(timeline.statusCode).toBe(200);
    const timelineBody = timeline.json() as { events: Array<{ type: string }> };

    const types = timelineBody.events.map((event) => event.type);
    expect(types).toContain("click");
    expect(types).toContain("credential_submit_simulated");
    expect(types).toContain("training_completed");
    expect(types).toContain("reported");
  });

  it("handles webhook idempotency and event deduplication", async () => {
    const signupPayload = await signup();

    await app.inject({
      method: "POST",
      url: "/employees/import-csv",
      headers: authHeader(signupPayload.token),
      payload: {
        csv: "email,full_name,department\nalice@demo.local,Alice Demo,Finance",
      },
    });

    const { campaignId } = await createReadyCampaign(signupPayload.token);
    await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/dispatch`,
      headers: authHeader(signupPayload.token),
      payload: {},
    });

    const recipients = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/recipients`,
      headers: authHeader(signupPayload.token),
    });
    const recipient = (recipients.json() as { items: Array<{ providerMessageId: string | null }> }).items[0];
    expect(recipient.providerMessageId).toBeTruthy();

    const first = await app.inject({
      method: "POST",
      url: "/webhooks/email-provider",
      payload: {
        events: [
          {
            provider: "mock",
            eventId: "event-1",
            messageId: recipient.providerMessageId,
            eventType: "delivered",
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ processed: 1, createdEvents: 1 });

    const duplicateWebhook = await app.inject({
      method: "POST",
      url: "/webhooks/email-provider",
      payload: {
        events: [
          {
            provider: "mock",
            eventId: "event-1",
            messageId: recipient.providerMessageId,
            eventType: "delivered",
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(duplicateWebhook.statusCode).toBe(200);
    expect(duplicateWebhook.json()).toMatchObject({ duplicateWebhook: 1 });

    const duplicateEvent = await app.inject({
      method: "POST",
      url: "/webhooks/email-provider",
      payload: {
        events: [
          {
            provider: "mock",
            eventId: "event-2",
            messageId: recipient.providerMessageId,
            eventType: "delivered",
            occurredAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(duplicateEvent.statusCode).toBe(200);
    expect(duplicateEvent.json()).toMatchObject({ duplicateEvent: 1 });
  });

  it("enforces manual review before tenant restriction and keeps event ingestion available", async () => {
    const signupPayload = await signup();

    const importEmployees = await app.inject({
      method: "POST",
      url: "/employees/import-csv",
      headers: authHeader(signupPayload.token),
      payload: {
        csv: buildDemoCsv(10),
      },
    });
    expect(importEmployees.statusCode).toBe(200);

    const { campaignId } = await createReadyCampaign(signupPayload.token);

    const dispatch = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/dispatch`,
      headers: authHeader(signupPayload.token),
      payload: {},
    });
    expect(dispatch.statusCode).toBe(200);

    const recipientsResponse = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/recipients`,
      headers: authHeader(signupPayload.token),
    });
    expect(recipientsResponse.statusCode).toBe(200);
    const recipients = (recipientsResponse.json() as { items: Array<{ trackingToken: string; id: string }> }).items;
    expect(recipients.length).toBe(10);

    for (const recipient of recipients.slice(0, 4)) {
      const credential = await app.inject({
        method: "POST",
        url: "/events/credential-submit-simulated",
        payload: {
          trackingToken: recipient.trackingToken,
          username: "employee@demo.local",
          password: "NEVER_STORE",
        },
      });
      expect(credential.statusCode).toBe(200);
    }

    const evaluate = await app.inject({
      method: "POST",
      url: `/campaigns/${campaignId}/evaluate-risk`,
      headers: authHeader(signupPayload.token),
      payload: { note: "test evaluation" },
    });
    expect(evaluate.statusCode).toBe(200);
    const evaluateBody = evaluate.json() as {
      evaluationReady: boolean;
      matchedViolations: Array<{ id: string; type: string; status: string }>;
    };
    expect(evaluateBody.evaluationReady).toBe(true);
    const highCredentialViolation = evaluateBody.matchedViolations.find(
      (violation) => violation.type === "high_credential_submit_rate",
    );
    expect(highCredentialViolation).toBeDefined();

    const blockedRestriction = await app.inject({
      method: "POST",
      url: `/ops/tenants/${signupPayload.tenant.id}/restrict`,
      headers: authHeader(signupPayload.token),
      payload: {
        restricted: true,
        reason: "manual restriction",
        policyViolationId: highCredentialViolation!.id,
      },
    });
    expect(blockedRestriction.statusCode).toBe(409);

    const review = await app.inject({
      method: "POST",
      url: `/ops/policy-violations/${highCredentialViolation!.id}/review`,
      headers: authHeader(signupPayload.token),
      payload: {
        decision: "approve_for_restriction",
        note: "approved by reviewer",
      },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toMatchObject({ status: "approved_for_restriction" });

    const restricted = await app.inject({
      method: "POST",
      url: `/ops/tenants/${signupPayload.tenant.id}/restrict`,
      headers: authHeader(signupPayload.token),
      payload: {
        restricted: true,
        reason: "manual restriction",
        policyViolationId: highCredentialViolation!.id,
      },
    });
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json()).toMatchObject({ status: "restricted", sendPaused: true });

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: authHeader(signupPayload.token),
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { sendingDomains: Array<{ id: string }> };

    const blockedCampaign = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: authHeader(signupPayload.token),
      payload: {
        name: "Blocked schedule",
        templateName: "Invoice",
        sendingMode: "dedicated",
        sendingDomainId: meBody.sendingDomains[0].id,
      },
    });
    expect(blockedCampaign.statusCode).toBe(201);
    const blockedCampaignId = (blockedCampaign.json() as { id: string }).id;

    const previewBlocked = await app.inject({
      method: "POST",
      url: `/campaigns/${blockedCampaignId}/preview`,
      headers: authHeader(signupPayload.token),
    });
    expect(previewBlocked.statusCode).toBe(200);

    const scheduleBlocked = await app.inject({
      method: "POST",
      url: `/campaigns/${blockedCampaignId}/schedule`,
      headers: authHeader(signupPayload.token),
      payload: { scheduledAt: new Date().toISOString() },
    });
    expect(scheduleBlocked.statusCode).toBe(423);

    const ingestionStillWorks = await app.inject({
      method: "POST",
      url: "/events/report-phish",
      payload: { trackingToken: recipients[0].trackingToken },
    });
    expect(ingestionStillWorks.statusCode).toBe(200);

    const overview = await app.inject({
      method: "GET",
      url: "/risk/overview",
      headers: authHeader(signupPayload.token),
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      unresolvedViolations: { highSeverity: 1 },
    });
  });
});
