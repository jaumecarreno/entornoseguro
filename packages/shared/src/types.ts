export type Role = "owner" | "admin";

export type LifecycleMode = "sandbox" | "production";

export type SendingMode = "dedicated" | "customer_domain";

export type TargetDomainVerificationStatus = "pending" | "demo_verified" | "blocked";

export type SendingDomainVerificationStatus =
  | "active"
  | "pending"
  | "stub_verified"
  | "blocked";

export type CampaignStatus =
  | "draft"
  | "previewed"
  | "scheduled"
  | "sending"
  | "completed"
  | "paused";

export type DataClass = "demo_only" | "real";

export type RecipientSendStatus = "pending" | "sent" | "failed";

export type RecipientEventType =
  | "delivered"
  | "open"
  | "click"
  | "credential_submit_simulated"
  | "reported"
  | "training_started"
  | "training_completed";

export type PauseScope = "global" | "tenant" | "campaign";

export interface PauseState {
  globalPaused: boolean;
  tenantPaused: boolean;
  campaignPaused: boolean;
}

export interface PauseDecision {
  blocked: boolean;
  scope: PauseScope | null;
  code: "PAUSED_GLOBAL" | "PAUSED_TENANT" | "PAUSED_CAMPAIGN" | "NOT_PAUSED";
}
