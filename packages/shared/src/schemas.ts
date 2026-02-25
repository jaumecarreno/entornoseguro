import { z } from "zod";

const domainRegex = /^(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export const signupTenantSchema = z.object({
  companyName: z.string().min(2),
  adminEmail: z.string().email(),
  defaultSendingMode: z.enum(["dedicated", "customer_domain"]).default("dedicated"),
});

export const createTargetDomainSchema = z.object({
  domain: z.string().regex(domainRegex),
});

export const createSendingDomainSchema = z
  .object({
    mode: z.enum(["dedicated", "customer_domain"]),
    domain: z.string().regex(domainRegex).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "customer_domain" && !data.domain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["domain"],
        message: "domain is required for customer_domain",
      });
    }
  });

export const patchTenantSendingModeSchema = z.object({
  defaultSendingMode: z.enum(["dedicated", "customer_domain"]),
});

export const importEmployeesSchema = z.object({
  csv: z.string().min(1),
});

export const createCampaignSchema = z.object({
  name: z.string().min(2),
  templateName: z.string().min(2),
  sendingMode: z.enum(["dedicated", "customer_domain"]),
  sendingDomainId: z.string().min(1),
});

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.string().datetime(),
});

export const pauseSchema = z.object({
  paused: z.boolean(),
  reason: z.string().min(3).max(250),
});

export const evaluateCampaignRiskSchema = z.object({
  note: z.string().min(3).max(250).optional(),
});

export const policyReviewSchema = z.object({
  decision: z.enum(["approve_for_restriction", "dismiss"]),
  note: z.string().min(3).max(250),
});

export const tenantRestrictSchema = z
  .object({
    restricted: z.boolean(),
    reason: z.string().min(3).max(250),
    policyViolationId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.restricted && !data.policyViolationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyViolationId"],
        message: "policyViolationId is required when restricted=true",
      });
    }
  });

export const timelineScopeSchema = z.object({
  scope: z.enum(["demo", "real", "all"]).default("all"),
});

export const dispatchCampaignSchema = z.object({
  force: z.boolean().default(false),
});

export const providerWebhookSchema = z.object({
  provider: z.string().min(2).default("mock"),
  eventId: z.string().min(2),
  messageId: z.string().min(2),
  eventType: z.enum(["delivered", "open", "click"]),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const providerWebhookBatchSchema = z.object({
  events: z.array(providerWebhookSchema).min(1),
});

export const trackingTokenEventSchema = z.object({
  trackingToken: z.string().min(10),
});

export const credentialSubmitSchema = z.object({
  trackingToken: z.string().min(10),
  username: z.string().min(1).max(250).optional(),
  password: z.string().min(1).max(500).optional(),
});

export const trainingStartSchema = z.object({
  trackingToken: z.string().min(10),
});

export const trainingCompleteSchema = z.object({
  answers: z.array(z.number().int().nonnegative()).default([]),
  score: z.number().min(0).max(100).optional(),
});
