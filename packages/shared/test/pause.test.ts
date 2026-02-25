import { describe, expect, it } from "vitest";
import { resolvePausePrecedence, assertSingleActiveTargetDomain } from "../src/index.js";

describe("resolvePausePrecedence", () => {
  it("applies global over tenant and campaign", () => {
    const result = resolvePausePrecedence({
      globalPaused: true,
      tenantPaused: true,
      campaignPaused: true,
    });

    expect(result.code).toBe("PAUSED_GLOBAL");
  });

  it("applies tenant when global is false", () => {
    const result = resolvePausePrecedence({
      globalPaused: false,
      tenantPaused: true,
      campaignPaused: true,
    });

    expect(result.code).toBe("PAUSED_TENANT");
  });

  it("returns not paused when all flags are false", () => {
    const result = resolvePausePrecedence({
      globalPaused: false,
      tenantPaused: false,
      campaignPaused: false,
    });

    expect(result.code).toBe("NOT_PAUSED");
    expect(result.blocked).toBe(false);
  });
});

describe("assertSingleActiveTargetDomain", () => {
  it("throws for more than one target domain", () => {
    expect(() => assertSingleActiveTargetDomain(1)).toThrowError();
  });

  it("allows creating first target domain", () => {
    expect(() => assertSingleActiveTargetDomain(0)).not.toThrowError();
  });
});
