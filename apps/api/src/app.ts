import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { JsonDatabase, type AdminUser, type Campaign, type Tenant } from "@entornoseguro/db";
import {
  assertSingleActiveTargetDomain,
  createCampaignSchema,
  createSendingDomainSchema,
  createTargetDomainSchema,
  domainFromEmail,
  importEmployeesSchema,
  normalizeDomain,
  patchTenantSendingModeSchema,
  pauseSchema,
  resolvePausePrecedence,
  scheduleCampaignSchema,
  signupTenantSchema,
  slugifyTenantName,
  timelineScopeSchema,
} from "@entornoseguro/shared";

interface CreateAppOptions {
  dbFilePath?: string;
  platformSimDomain?: string;
  logger?: boolean;
}

interface ActorContext {
  admin: AdminUser;
  tenant: Tenant;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmployeeCsv(csv: string): { rows: Array<{ email: string; fullName: string; department: string | null }>; errors: string[] } {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must include header and at least one row"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const emailIdx = headers.indexOf("email");
  const nameIdx = headers.indexOf("full_name") >= 0 ? headers.indexOf("full_name") : headers.indexOf("name");
  const deptIdx = headers.indexOf("department");

  if (emailIdx === -1 || nameIdx === -1) {
    return { rows: [], errors: ["CSV header must include email and full_name (or name)"] };
  }

  const rows: Array<{ email: string; fullName: string; department: string | null }> = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const email = (cols[emailIdx] ?? "").toLowerCase();
    const fullName = cols[nameIdx] ?? "";
    const department = deptIdx >= 0 ? cols[deptIdx] || null : null;

    if (!emailRegex.test(email)) {
      errors.push(`Line ${i + 1}: invalid email`);
      continue;
    }

    if (!fullName) {
      errors.push(`Line ${i + 1}: missing full_name`);
      continue;
    }

    rows.push({ email, fullName, department });
  }

  return { rows, errors };
}

async function getActorContext(
  request: FastifyRequest,
  reply: FastifyReply,
  db: JsonDatabase,
): Promise<ActorContext | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  const context = await db.read((data) => {
    const admin = data.adminUsers.find((candidate) => candidate.authToken === token);
    if (!admin) {
      return null;
    }
    const tenant = data.tenants.find((candidate) => candidate.id === admin.tenantId);
    if (!tenant) {
      return null;
    }
    return { admin, tenant };
  });

  if (!context) {
    reply.status(401).send({ error: "Unauthorized" });
    return null;
  }

  return context;
}

function createDedicatedDomain(slug: string, platformSimDomain: string): string {
  return `${slug}.${platformSimDomain}`;
}

function ensureUniqueSlug(existingSlugs: Set<string>, base: string): string {
  if (!existingSlugs.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingSlugs.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const dbFilePath = options.dbFilePath ?? path.join(process.cwd(), "data", "stage1-db.json");
  const platformSimDomain = options.platformSimDomain ?? "sim.entornoseguro.local";
  const db = new JsonDatabase(dbFilePath);
  await db.init();

  const app = Fastify({ logger: options.logger ?? true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/signup-tenant", async (request, reply) => {
    const parsed = signupTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { companyName, adminEmail, defaultSendingMode } = parsed.data;
    const now = new Date().toISOString();

    const created = await db.write((data) => {
      const baseSlug = slugifyTenantName(companyName) || "tenant";
      const slug = ensureUniqueSlug(
        new Set(data.tenants.map((tenant) => tenant.slug)),
        baseSlug,
      );

      const tenantId = db.newId();
      const adminId = db.newId();
      const token = randomUUID();
      const dedicatedSendingDomainId = db.newId();

      const tenant: Tenant = {
        id: tenantId,
        name: companyName,
        slug,
        status: "active",
        lifecycleMode: "sandbox",
        defaultSendingMode,
        sendPaused: false,
        createdAt: now,
      };

      data.tenants.push(tenant);

      const admin: AdminUser = {
        id: adminId,
        tenantId,
        email: adminEmail.toLowerCase(),
        role: "owner",
        authToken: token,
        createdAt: now,
      };
      data.adminUsers.push(admin);

      data.sendingDomains.push({
        id: dedicatedSendingDomainId,
        tenantId,
        mode: "dedicated",
        domain: createDedicatedDomain(slug, platformSimDomain),
        verificationStatus: "active",
        providerIdentityId: null,
        createdAt: now,
      });

      data.auditLogs.push({
        id: db.newId(),
        tenantId,
        actorType: "admin",
        actorId: adminId,
        action: "tenant.signup",
        resourceType: "tenant",
        resourceId: tenantId,
        reason: null,
        metadata: { defaultSendingMode },
        createdAt: now,
      });

      return {
        tenant,
        admin: { id: admin.id, email: admin.email, role: admin.role },
        token,
      };
    });

    return reply.status(201).send(created);
  });

  app.get("/me", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const me = await db.read((data) => {
      const targetDomain = data.targetDomains.find((domain) => domain.tenantId === actor.tenant.id) ?? null;
      const sendingDomains = data.sendingDomains.filter((domain) => domain.tenantId === actor.tenant.id);
      return {
        admin: { id: actor.admin.id, email: actor.admin.email, role: actor.admin.role },
        tenant: actor.tenant,
        targetDomain,
        sendingDomains,
        system: {
          globalSendPaused: data.system.globalSendPaused,
        },
      };
    });

    return reply.send(me);
  });

  app.post("/target-domains", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = createTargetDomainSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await db.write((data) => {
        const existingCount = data.targetDomains.filter((domain) => domain.tenantId === actor.tenant.id).length;
        assertSingleActiveTargetDomain(existingCount);

        const targetDomain = {
          id: db.newId(),
          tenantId: actor.tenant.id,
          domain: normalizeDomain(parsed.data.domain),
          verificationStatus: "pending" as const,
          verifiedAt: null,
          createdAt: db.nowIso(),
        };

        data.targetDomains.push(targetDomain);
        data.auditLogs.push({
          id: db.newId(),
          tenantId: actor.tenant.id,
          actorType: "admin",
          actorId: actor.admin.id,
          action: "target_domain.create",
          resourceType: "target_domain",
          resourceId: targetDomain.id,
          reason: null,
          metadata: { domain: targetDomain.domain },
          createdAt: db.nowIso(),
        });

        return targetDomain;
      });

      return reply.status(201).send(created);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
  });

  app.post("/target-domains/:id/verify-demo", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    const verified = await db.write((data) => {
      const domain = data.targetDomains.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id);
      if (!domain) {
        return null;
      }

      domain.verificationStatus = "demo_verified";
      domain.verifiedAt = db.nowIso();

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "target_domain.verify_demo",
        resourceType: "target_domain",
        resourceId: domain.id,
        reason: "stage1_demo",
        metadata: {},
        createdAt: db.nowIso(),
      });

      return domain;
    });

    if (!verified) {
      return reply.status(404).send({ error: "Target domain not found" });
    }

    return reply.send(verified);
  });

  app.post("/sending-domains", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = createSendingDomainSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const created = await db.write((data) => {
      if (parsed.data.mode === "dedicated") {
        const existing = data.sendingDomains.find(
          (domain) => domain.tenantId === actor.tenant.id && domain.mode === "dedicated",
        );

        if (existing) {
          return existing;
        }

        const dedicated = {
          id: db.newId(),
          tenantId: actor.tenant.id,
          mode: "dedicated" as const,
          domain: createDedicatedDomain(actor.tenant.slug, platformSimDomain),
          verificationStatus: "active" as const,
          providerIdentityId: null,
          createdAt: db.nowIso(),
        };

        data.sendingDomains.push(dedicated);
        data.auditLogs.push({
          id: db.newId(),
          tenantId: actor.tenant.id,
          actorType: "admin",
          actorId: actor.admin.id,
          action: "sending_domain.create_dedicated",
          resourceType: "sending_domain",
          resourceId: dedicated.id,
          reason: null,
          metadata: { domain: dedicated.domain },
          createdAt: db.nowIso(),
        });

        return dedicated;
      }

      const normalized = normalizeDomain(parsed.data.domain ?? "");
      const duplicate = data.sendingDomains.find(
        (domain) => domain.tenantId === actor.tenant.id && domain.mode === "customer_domain" && domain.domain === normalized,
      );

      if (duplicate) {
        return duplicate;
      }

      const createdDomain = {
        id: db.newId(),
        tenantId: actor.tenant.id,
        mode: "customer_domain" as const,
        domain: normalized,
        verificationStatus: "pending" as const,
        providerIdentityId: null,
        createdAt: db.nowIso(),
      };

      data.sendingDomains.push(createdDomain);
      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "sending_domain.create_customer_stub",
        resourceType: "sending_domain",
        resourceId: createdDomain.id,
        reason: "stage1_stub",
        metadata: { domain: createdDomain.domain },
        createdAt: db.nowIso(),
      });

      return createdDomain;
    });

    return reply.status(201).send(created);
  });

  app.post("/sending-domains/:id/verify-stub", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    const updated = await db.write((data) => {
      const domain = data.sendingDomains.find(
        (candidate) =>
          candidate.id === id &&
          candidate.tenantId === actor.tenant.id &&
          candidate.mode === "customer_domain",
      );

      if (!domain) {
        return null;
      }

      domain.verificationStatus = "stub_verified";

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "sending_domain.verify_stub",
        resourceType: "sending_domain",
        resourceId: domain.id,
        reason: "stage1_stub",
        metadata: {},
        createdAt: db.nowIso(),
      });

      return domain;
    });

    if (!updated) {
      return reply.status(404).send({ error: "Sending domain not found" });
    }

    return reply.send(updated);
  });

  app.patch("/tenants/:id/default-sending-mode", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    if (id !== actor.tenant.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsed = patchTenantSendingModeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const updated = await db.write((data) => {
      const tenant = data.tenants.find((candidate) => candidate.id === id);
      if (!tenant) {
        return { error: "not_found" as const };
      }

      if (parsed.data.defaultSendingMode === "customer_domain") {
        const verifiedCustomerDomain = data.sendingDomains.find(
          (domain) =>
            domain.tenantId === id &&
            domain.mode === "customer_domain" &&
            domain.verificationStatus === "stub_verified",
        );

        if (!verifiedCustomerDomain) {
          return { error: "missing_customer_domain" as const };
        }
      }

      tenant.defaultSendingMode = parsed.data.defaultSendingMode;
      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "tenant.default_sending_mode.update",
        resourceType: "tenant",
        resourceId: tenant.id,
        reason: null,
        metadata: { defaultSendingMode: parsed.data.defaultSendingMode },
        createdAt: db.nowIso(),
      });

      return { tenant };
    });

    if ("error" in updated) {
      if (updated.error === "not_found") {
        return reply.status(404).send({ error: "Tenant not found" });
      }

      return reply
        .status(400)
        .send({ error: "Cannot set customer_domain as default without a stub_verified customer sending domain" });
    }

    return reply.send(updated.tenant);
  });

  app.post("/employees/import-csv", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = importEmployeesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const parseResult = parseEmployeeCsv(parsed.data.csv);
    if (parseResult.errors.length > 0 && parseResult.rows.length === 0) {
      return reply.status(400).send({ error: parseResult.errors });
    }

    const imported = await db.write((data) => {
      const targetDomain = data.targetDomains.find((domain) => domain.tenantId === actor.tenant.id) ?? null;
      const errors = [...parseResult.errors];

      const dataClass = actor.tenant.lifecycleMode === "sandbox" ? "demo_only" : "real";

      for (const row of parseResult.rows) {
        if (actor.tenant.lifecycleMode === "production") {
          if (!targetDomain || targetDomain.verificationStatus !== "demo_verified") {
            errors.push("Target domain must be verified before importing employees in production mode");
            continue;
          }

          if (domainFromEmail(row.email) !== targetDomain.domain) {
            errors.push(`Rejected ${row.email}: outside target domain ${targetDomain.domain}`);
            continue;
          }
        }

        const existing = data.employees.find(
          (employee) => employee.tenantId === actor.tenant.id && employee.email === row.email,
        );
        if (existing) {
          continue;
        }

        data.employees.push({
          id: db.newId(),
          tenantId: actor.tenant.id,
          email: row.email,
          fullName: row.fullName,
          department: row.department,
          dataClass,
          createdAt: db.nowIso(),
        });
      }

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "employee.import_csv",
        resourceType: "employee",
        resourceId: actor.tenant.id,
        reason: null,
        metadata: { inputRows: parseResult.rows.length, errors: errors.length },
        createdAt: db.nowIso(),
      });

      const importedCount = data.employees.filter((employee) => employee.tenantId === actor.tenant.id).length;
      return { importedCount, errors };
    });

    return reply.send(imported);
  });

  app.get("/employees", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const employees = await db.read((data) =>
      data.employees
        .filter((employee) => employee.tenantId === actor.tenant.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );

    return reply.send({ items: employees });
  });

  app.post("/campaigns", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const created = await db.write((data) => {
      const sendingDomain = data.sendingDomains.find(
        (domain) => domain.id === parsed.data.sendingDomainId && domain.tenantId === actor.tenant.id,
      );

      if (!sendingDomain) {
        return { error: "missing_sending_domain" as const };
      }

      if (sendingDomain.mode !== parsed.data.sendingMode) {
        return { error: "sending_mode_mismatch" as const };
      }

      const campaign: Campaign = {
        id: db.newId(),
        tenantId: actor.tenant.id,
        name: parsed.data.name,
        templateName: parsed.data.templateName,
        sendingMode: parsed.data.sendingMode,
        sendingDomainId: parsed.data.sendingDomainId,
        status: "draft",
        paused: false,
        scheduledAt: null,
        dataScope: actor.tenant.lifecycleMode === "sandbox" ? "demo_only" : "real",
        createdByAdminId: actor.admin.id,
        createdAt: db.nowIso(),
      };

      data.campaigns.push(campaign);
      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "campaign.create",
        resourceType: "campaign",
        resourceId: campaign.id,
        reason: null,
        metadata: { sendingMode: campaign.sendingMode },
        createdAt: db.nowIso(),
      });

      return { campaign };
    });

    if ("error" in created) {
      if (created.error === "missing_sending_domain") {
        return reply.status(404).send({ error: "Sending domain not found" });
      }

      return reply.status(400).send({ error: "Campaign sendingMode must match selected sendingDomain" });
    }

    return reply.status(201).send(created.campaign);
  });

  app.post("/campaigns/:id/preview", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    const preview = await db.write((data) => {
      const campaign = data.campaigns.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id);
      if (!campaign) {
        return null;
      }

      campaign.status = "previewed";

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "campaign.preview",
        resourceType: "campaign",
        resourceId: campaign.id,
        reason: "stage1_demo",
        metadata: {},
        createdAt: db.nowIso(),
      });

      return {
        campaignId: campaign.id,
        dataScope: campaign.dataScope,
        emailPreview: {
          subject: `[Simulation] ${campaign.templateName}`,
          body: `Hello {{employee_name}}, this is a controlled phishing simulation preview for campaign ${campaign.name}.`,
          badge: "demo-only",
        },
        employeeJourneyPreview: {
          landingPath: `/training/preview/${campaign.id}`,
          quizQuestions: 3,
        },
      };
    });

    if (!preview) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    return reply.send(preview);
  });

  app.post("/campaigns/:id/schedule", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsedBody = scheduleCampaignSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const result = await db.write((data) => {
      const tenant = data.tenants.find((candidate) => candidate.id === actor.tenant.id);
      const campaign = data.campaigns.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id);

      if (!tenant || !campaign) {
        return { error: "not_found" as const };
      }

      const pause = resolvePausePrecedence({
        globalPaused: data.system.globalSendPaused,
        tenantPaused: tenant.sendPaused,
        campaignPaused: campaign.paused,
      });

      if (pause.blocked) {
        return { error: "paused" as const, pause };
      }

      if (campaign.status !== "previewed") {
        return { error: "preview_required" as const };
      }

      const sendingDomain = data.sendingDomains.find((domain) => domain.id === campaign.sendingDomainId);
      if (!sendingDomain) {
        return { error: "missing_sending_domain" as const };
      }

      if (campaign.sendingMode === "customer_domain" && sendingDomain.verificationStatus !== "stub_verified") {
        return { error: "customer_domain_not_stub_verified" as const };
      }

      campaign.scheduledAt = parsedBody.data.scheduledAt;
      campaign.status = "scheduled";

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaign.id,
        reason: null,
        metadata: { scheduledAt: campaign.scheduledAt },
        createdAt: db.nowIso(),
      });

      return { campaign };
    });

    if (result.error === "not_found") {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    if (result.error === "paused") {
      return reply.status(409).send({ error: result.pause.code, scope: result.pause.scope });
    }

    if (result.error === "preview_required") {
      return reply.status(409).send({ error: "Campaign preview is required before scheduling" });
    }

    if (result.error === "missing_sending_domain") {
      return reply.status(404).send({ error: "Sending domain missing" });
    }

    if (result.error === "customer_domain_not_stub_verified") {
      return reply.status(409).send({ error: "Customer sending domain must be stub_verified before scheduling" });
    }

    return reply.send(result.campaign);
  });

  app.get("/campaigns/:id/training-preview", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    const campaign = await db.read((data) =>
      data.campaigns.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id),
    );

    if (!campaign) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    return reply.send({
      campaignId: campaign.id,
      dataClass: "demo_only",
      module: {
        title: "Spot suspicious urgency",
        summary: "Pause and verify before acting on urgent requests.",
        points: [
          "Check sender domain carefully",
          "Never submit credentials from email links",
          "Report suspicious emails quickly",
        ],
      },
      quiz: [
        {
          id: "q1",
          question: "What is the safest first step after clicking a suspicious link?",
          options: ["Report it", "Ignore it", "Reply with credentials"],
          correctOption: 0,
        },
        {
          id: "q2",
          question: "A misspelled domain usually indicates:",
          options: ["A trusted sender", "Potential phishing", "Normal behavior"],
          correctOption: 1,
        },
      ],
      badge: "demo-only",
    });
  });

  app.get("/employees/:id/timeline", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    if (actor.admin.role !== "owner" && actor.admin.role !== "admin") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsedQuery = timelineScopeSchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const payload = await db.read((data) => {
      const employee = data.employees.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id);
      if (!employee) {
        return null;
      }

      const tenantCampaign = data.campaigns.find((candidate) => candidate.tenantId === actor.tenant.id) ?? null;

      return {
        employee,
        scope: parsedQuery.data.scope,
        badge: "demo-only",
        events: [
          {
            type: "simulation_preview_sent",
            at: tenantCampaign?.createdAt ?? db.nowIso(),
            dataClass: "demo_only",
            detail: tenantCampaign
              ? `Preview generated for campaign ${tenantCampaign.name}`
              : "Preview generated for demo campaign",
          },
          {
            type: "simulated_click",
            at: db.nowIso(),
            dataClass: "demo_only",
            detail: "Employee clicked demo simulation link",
          },
          {
            type: "training_preview_completed",
            at: db.nowIso(),
            dataClass: "demo_only",
            detail: "Employee completed mock micro-quiz",
          },
        ],
      };
    });

    if (!payload) {
      return reply.status(404).send({ error: "Employee not found" });
    }

    return reply.send(payload);
  });

  app.post("/ops/pause-global", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = pauseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = await db.write((data) => {
      data.system.globalSendPaused = parsed.data.paused;
      data.operationalControls.push({
        id: db.newId(),
        scope: "global",
        scopeId: null,
        paused: parsed.data.paused,
        reason: parsed.data.reason,
        setByAdminId: actor.admin.id,
        createdAt: db.nowIso(),
      });

      data.auditLogs.push({
        id: db.newId(),
        tenantId: null,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "ops.pause_global",
        resourceType: "system",
        resourceId: "global_send",
        reason: parsed.data.reason,
        metadata: { paused: parsed.data.paused },
        createdAt: db.nowIso(),
      });

      return { globalSendPaused: data.system.globalSendPaused };
    });

    return reply.send(result);
  });

  app.post("/ops/tenants/:id/pause", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const { id } = request.params as { id: string };
    if (id !== actor.tenant.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsed = pauseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const result = await db.write((data) => {
      const tenant = data.tenants.find((candidate) => candidate.id === id);
      if (!tenant) {
        return null;
      }

      tenant.sendPaused = parsed.data.paused;
      data.operationalControls.push({
        id: db.newId(),
        scope: "tenant",
        scopeId: tenant.id,
        paused: parsed.data.paused,
        reason: parsed.data.reason,
        setByAdminId: actor.admin.id,
        createdAt: db.nowIso(),
      });

      data.auditLogs.push({
        id: db.newId(),
        tenantId: tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "ops.pause_tenant",
        resourceType: "tenant",
        resourceId: tenant.id,
        reason: parsed.data.reason,
        metadata: { paused: parsed.data.paused },
        createdAt: db.nowIso(),
      });

      return { tenantId: tenant.id, sendPaused: tenant.sendPaused };
    });

    if (!result) {
      return reply.status(404).send({ error: "Tenant not found" });
    }

    return reply.send(result);
  });

  app.post("/campaigns/:id/pause", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const parsed = pauseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const result = await db.write((data) => {
      const campaign = data.campaigns.find((candidate) => candidate.id === id && candidate.tenantId === actor.tenant.id);
      if (!campaign) {
        return null;
      }

      campaign.paused = parsed.data.paused;
      if (parsed.data.paused) {
        campaign.status = "paused";
      } else if (campaign.scheduledAt) {
        campaign.status = "scheduled";
      } else {
        campaign.status = "draft";
      }

      data.operationalControls.push({
        id: db.newId(),
        scope: "campaign",
        scopeId: campaign.id,
        paused: parsed.data.paused,
        reason: parsed.data.reason,
        setByAdminId: actor.admin.id,
        createdAt: db.nowIso(),
      });

      data.auditLogs.push({
        id: db.newId(),
        tenantId: actor.tenant.id,
        actorType: "admin",
        actorId: actor.admin.id,
        action: "ops.pause_campaign",
        resourceType: "campaign",
        resourceId: campaign.id,
        reason: parsed.data.reason,
        metadata: { paused: parsed.data.paused },
        createdAt: db.nowIso(),
      });

      return campaign;
    });

    if (!result) {
      return reply.status(404).send({ error: "Campaign not found" });
    }

    return reply.send(result);
  });

  app.get("/campaigns", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const campaigns = await db.read((data) =>
      data.campaigns
        .filter((campaign) => campaign.tenantId === actor.tenant.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );

    return reply.send({ items: campaigns });
  });

  app.get("/audit-logs", async (request, reply) => {
    const actor = await getActorContext(request, reply, db);
    if (!actor) {
      return;
    }

    const logs = await db.read((data) =>
      data.auditLogs
        .filter((log) => log.tenantId === null || log.tenantId === actor.tenant.id)
        .slice(-100)
        .reverse(),
    );

    return reply.send({ items: logs });
  });

  return app;
}
