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

export const timelineScopeSchema = z.object({
  scope: z.enum(["demo"]).default("demo"),
});
