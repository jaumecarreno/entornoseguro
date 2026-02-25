import type {
  CampaignStatus,
  DataClass,
  LifecycleMode,
  PolicyViolationSeverity,
  PolicyViolationStatus,
  PolicyViolationType,
  RecipientEventType,
  RecipientSendStatus,
  Role,
  SendingDomainVerificationStatus,
  SendingMode,
  TenantStatus,
  TargetDomainVerificationStatus,
} from "@entornoseguro/shared";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  lifecycleMode: LifecycleMode;
  defaultSendingMode: SendingMode;
  sendPaused: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  authToken: string;
  createdAt: string;
}

export interface TargetDomain {
  id: string;
  tenantId: string;
  domain: string;
  verificationStatus: TargetDomainVerificationStatus;
  verifiedAt: string | null;
  createdAt: string;
}

export interface SendingDomain {
  id: string;
  tenantId: string;
  mode: SendingMode;
  domain: string;
  verificationStatus: SendingDomainVerificationStatus;
  providerIdentityId: string | null;
  createdAt: string;
}

export interface Employee {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  department: string | null;
  dataClass: DataClass;
  createdAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  templateName: string;
  sendingMode: SendingMode;
  sendingDomainId: string;
  status: CampaignStatus;
  paused: boolean;
  scheduledAt: string | null;
  dataScope: DataClass;
  createdByAdminId: string;
  createdAt: string;
}

export interface CampaignRecipient {
  id: string;
  tenantId: string;
  campaignId: string;
  employeeId: string;
  email: string;
  fullName: string;
  trackingToken: string;
  sendStatus: RecipientSendStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  dataClass: DataClass;
  createdAt: string;
}

export interface RecipientEvent {
  id: string;
  tenantId: string;
  campaignRecipientId: string;
  eventType: RecipientEventType;
  dedupeKey: string;
  dataClass: DataClass;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface TrainingSession {
  id: string;
  tenantId: string;
  campaignRecipientId: string;
  startedAt: string;
  completedAt: string | null;
  dataClass: DataClass;
}

export interface QuizAttempt {
  id: string;
  tenantId: string;
  trainingSessionId: string;
  score: number;
  passed: boolean;
  answers: number[];
  createdAt: string;
}

export interface ProcessedWebhook {
  id: string;
  provider: string;
  eventId: string;
  messageId: string;
  processedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  actorType: "admin" | "system";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OperationalControl {
  id: string;
  scope: "global" | "tenant" | "campaign";
  scopeId: string | null;
  paused: boolean;
  reason: string;
  setByAdminId: string;
  createdAt: string;
}

export interface PolicyViolation {
  id: string;
  tenantId: string;
  campaignId: string | null;
  type: PolicyViolationType;
  severity: PolicyViolationSeverity;
  status: PolicyViolationStatus;
  summary: string;
  threshold: number;
  observed: number;
  sampleSize: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByAdminId: string | null;
  reviewNote: string | null;
}

export interface DatabaseData {
  system: {
    globalSendPaused: boolean;
  };
  tenants: Tenant[];
  adminUsers: AdminUser[];
  targetDomains: TargetDomain[];
  sendingDomains: SendingDomain[];
  employees: Employee[];
  campaigns: Campaign[];
  campaignRecipients: CampaignRecipient[];
  recipientEvents: RecipientEvent[];
  trainingSessions: TrainingSession[];
  quizAttempts: QuizAttempt[];
  processedWebhooks: ProcessedWebhook[];
  auditLogs: AuditLog[];
  operationalControls: OperationalControl[];
  policyViolations: PolicyViolation[];
}
