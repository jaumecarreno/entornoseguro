import type { PauseDecision, PauseState } from "./types.js";

export function resolvePausePrecedence(state: PauseState): PauseDecision {
  if (state.globalPaused) {
    return { blocked: true, scope: "global", code: "PAUSED_GLOBAL" };
  }

  if (state.tenantPaused) {
    return { blocked: true, scope: "tenant", code: "PAUSED_TENANT" };
  }

  if (state.campaignPaused) {
    return { blocked: true, scope: "campaign", code: "PAUSED_CAMPAIGN" };
  }

  return { blocked: false, scope: null, code: "NOT_PAUSED" };
}

export function assertSingleActiveTargetDomain(existingCount: number): void {
  if (existingCount > 0) {
    throw new Error("Each tenant can only have one target domain in MVP stage 1.");
  }
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export function domainFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1] : "";
}

export function slugifyTenantName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
