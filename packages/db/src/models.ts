import type {
  CampaignStatus,
  DataClass,
  LifecycleMode,
  Role,
  SendingDomainVerificationStatus,
  SendingMode,
  TargetDomainVerificationStatus,
} from "@entornoseguro/shared";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: "active" | "restricted";
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
  auditLogs: AuditLog[];
  operationalControls: OperationalControl[];
}
