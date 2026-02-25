import { describe, expect, it } from "vitest";
import { policyReviewSchema, tenantRestrictSchema } from "../src/index.js";

describe("tenantRestrictSchema", () => {
  it("requires policyViolationId when restricting tenant", () => {
    const parsed = tenantRestrictSchema.safeParse({
      restricted: true,
      reason: "manual review",
    });

    expect(parsed.success).toBe(false);
  });

  it("allows unrestrict without policy violation id", () => {
    const parsed = tenantRestrictSchema.safeParse({
      restricted: false,
      reason: "manual restore",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("policyReviewSchema", () => {
  it("accepts conservative manual approval decision", () => {
    const parsed = policyReviewSchema.safeParse({
      decision: "approve_for_restriction",
      note: "checked and approved",
    });

    expect(parsed.success).toBe(true);
  });
});
