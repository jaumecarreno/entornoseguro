"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch, readToken, writeToken } from "./lib/api";

type SendingMode = "dedicated" | "customer_domain";

type MeResponse = {
  admin: { id: string; email: string; role: "owner" | "admin" };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "restricted";
    lifecycleMode: "sandbox" | "production";
    defaultSendingMode: SendingMode;
    sendPaused: boolean;
  };
  targetDomain: null | {
    id: string;
    domain: string;
    verificationStatus: "pending" | "demo_verified" | "blocked";
  };
  sendingDomains: Array<{
    id: string;
    mode: SendingMode;
    domain: string;
    verificationStatus: "active" | "pending" | "stub_verified" | "blocked";
  }>;
  system: { globalSendPaused: boolean };
};

type Employee = {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  dataClass: "demo_only" | "real";
};

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "previewed" | "scheduled" | "sending" | "completed" | "paused";
  sendingMode: SendingMode;
  sendingDomainId: string;
  dataScope: "demo_only" | "real";
  scheduledAt: string | null;
  recipientStats?: {
    total: number;
    sent: number;
    failed: number;
  };
};

type CampaignRecipient = {
  id: string;
  email: string;
  fullName: string;
  trackingToken: string;
  sendStatus: "pending" | "sent" | "failed";
  providerMessageId: string | null;
  dataClass: "demo_only" | "real";
};

type TimelinePayload = {
  badge: string;
  events: Array<{ type: string; at: string; detail: string; dataClass: string }>;
};

type PolicyViolation = {
  id: string;
  campaignId: string | null;
  type: "high_credential_submit_rate" | "low_report_rate" | "high_click_rate";
  severity: "medium" | "high";
  status: "open" | "approved_for_restriction" | "dismissed";
  summary: string;
  threshold: number;
  observed: number;
  sampleSize: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};

type RiskOverview = {
  score: number;
  level: "low" | "medium" | "high";
  metrics: {
    recipients: number;
    clickRate: number;
    credentialSubmitRate: number;
    reportRate: number;
    trainingCompletionRate: number;
    repeatSusceptibilityRate: number;
    medianTimeToReportMinutes: number | null;
    openRate: number;
  };
  breakdown: Array<{ metric: string; weight: number; value: number; contribution: number }>;
  unresolvedViolations: { total: number; highSeverity: number };
};

const defaultCsv = `email,full_name,department\nalice@demo.local,Alice Ruiz,Finance\nbob@demo.local,Bob Vidal,Sales`;

function makeEventId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export default function HomePage() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [auditItems, setAuditItems] = useState<Array<{ action: string; createdAt: string; reason: string | null }>>([]);
  const [policyViolations, setPolicyViolations] = useState<PolicyViolation[]>([]);
  const [riskOverview, setRiskOverview] = useState<RiskOverview | null>(null);

  const [signupCompany, setSignupCompany] = useState("Acme Pyme");
  const [signupEmail, setSignupEmail] = useState("owner@acme.test");
  const [targetDomainInput, setTargetDomainInput] = useState("acme.test");
  const [customerDomainInput, setCustomerDomainInput] = useState("mail.acme.test");
  const [csvInput, setCsvInput] = useState(defaultCsv);
  const [campaignName, setCampaignName] = useState("Q1 Seguridad");
  const [templateName, setTemplateName] = useState("Factura urgente");
  const [campaignSendingMode, setCampaignSendingMode] = useState<SendingMode>("dedicated");
  const [selectedSendingDomainId, setSelectedSendingDomainId] = useState<string>("");

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
  const [credentialUsername, setCredentialUsername] = useState("employee@demo.local");
  const [credentialPassword, setCredentialPassword] = useState("SuperSecret123");
  const [activeTrainingSessionId, setActiveTrainingSessionId] = useState<string>("");
  const [trainingResult, setTrainingResult] = useState<null | { score: number; passed: boolean }>(null);
  const [webhookSummary, setWebhookSummary] = useState<null | {
    processed: number;
    duplicateWebhook: number;
    duplicateEvent: number;
    unknownMessage: number;
    createdEvents: number;
  }>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [trainingPreview, setTrainingPreview] = useState<
    | null
    | {
        module: { title: string; summary: string; points: string[] };
        quiz: Array<{ id: string; question: string; options: string[] }>;
        badge: string;
      }
  >(null);
  const [previewPayload, setPreviewPayload] = useState<null | { emailPreview: { subject: string; body: string; badge: string } }>(null);

  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [globalPauseReason, setGlobalPauseReason] = useState("Maintenance window");
  const [tenantPauseReason, setTenantPauseReason] = useState("Tenant pause");
  const [campaignPauseReason, setCampaignPauseReason] = useState("Campaign pause");
  const [riskReviewNote, setRiskReviewNote] = useState("Conservative manual review");
  const [restrictionReason, setRestrictionReason] = useState("Manual restriction after policy review");

  const currentCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedRecipient = recipients.find((recipient) => recipient.id === selectedRecipientId) ?? null;
  const approvedViolation = policyViolations.find((violation) => violation.status === "approved_for_restriction") ?? null;

  const sendingDomainOptions = useMemo(() => {
    if (!me) {
      return [] as MeResponse["sendingDomains"];
    }

    return me.sendingDomains.filter((domain) => domain.mode === campaignSendingMode);
  }, [me, campaignSendingMode]);

  function clearNotices(): void {
    setStatusMessage("");
    setErrorMessage("");
  }

  function setSuccess(message: string): void {
    setErrorMessage("");
    setStatusMessage(message);
  }

  function setError(message: string): void {
    setStatusMessage("");
    setErrorMessage(message);
  }

  async function refreshAll(sessionToken: string): Promise<void> {
    const [meData, employeesData, campaignsData, auditData, policyData] = await Promise.all([
      apiFetch<MeResponse>("/me", {}, sessionToken),
      apiFetch<{ items: Employee[] }>("/employees", {}, sessionToken),
      apiFetch<{ items: Campaign[] }>("/campaigns", {}, sessionToken),
      apiFetch<{ items: Array<{ action: string; createdAt: string; reason: string | null }> }>(
        "/audit-logs",
        {},
        sessionToken,
      ),
      apiFetch<{ items: PolicyViolation[] }>("/ops/policy-violations", {}, sessionToken),
    ]);

    setMe(meData);
    setEmployees(employeesData.items);
    setCampaigns(campaignsData.items);
    setAuditItems(auditData.items);
    setPolicyViolations(policyData.items);

    if (campaignsData.items.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(campaignsData.items[0].id);
    }

    if (employeesData.items.length > 0 && !selectedEmployeeId) {
      setSelectedEmployeeId(employeesData.items[0].id);
    }

    if (meData.sendingDomains.length > 0) {
      const fallback = meData.sendingDomains.find((domain) => domain.mode === campaignSendingMode) ?? meData.sendingDomains[0];
      setSelectedSendingDomainId(fallback.id);
    }
  }

  async function loadRecipients(sessionToken: string, campaignId: string): Promise<void> {
    if (!campaignId) {
      setRecipients([]);
      setSelectedRecipientId("");
      return;
    }

    const response = await apiFetch<{ items: CampaignRecipient[] }>(`/campaigns/${campaignId}/recipients`, {}, sessionToken);
    setRecipients(response.items);

    if (response.items.length === 0) {
      setSelectedRecipientId("");
      return;
    }

    if (!response.items.some((item) => item.id === selectedRecipientId)) {
      setSelectedRecipientId(response.items[0].id);
    }
  }

  useEffect(() => {
    const existing = readToken();
    if (!existing) {
      return;
    }

    setToken(existing);
    refreshAll(existing).catch((error) => {
      setError(String(error instanceof Error ? error.message : error));
    });
  }, []);

  useEffect(() => {
    if (sendingDomainOptions.length === 0) {
      setSelectedSendingDomainId("");
      return;
    }

    if (!sendingDomainOptions.some((item) => item.id === selectedSendingDomainId)) {
      setSelectedSendingDomainId(sendingDomainOptions[0].id);
    }
  }, [sendingDomainOptions, selectedSendingDomainId]);

  useEffect(() => {
    if (!token || !selectedCampaignId) {
      return;
    }

    loadRecipients(token, selectedCampaignId).catch((error) => {
      setError(String(error instanceof Error ? error.message : error));
    });
  }, [token, selectedCampaignId]);

  async function handleSignup(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearNotices();

    try {
      const payload = await apiFetch<{
        token: string;
      }>("/auth/signup-tenant", {
        method: "POST",
        body: JSON.stringify({
          companyName: signupCompany,
          adminEmail: signupEmail,
          defaultSendingMode: "dedicated",
        }),
      });

      writeToken(payload.token);
      setToken(payload.token);
      await refreshAll(payload.token);
      setSuccess("Tenant creado en sandbox con dominio dedicated por tenant.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleCreateTargetDomain(): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      await apiFetch("/target-domains", {
        method: "POST",
        body: JSON.stringify({ domain: targetDomainInput }),
      }, token);
      await refreshAll(token);
      setSuccess("TargetDomain creado. Verifícalo en modo demo.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleVerifyTargetDomain(): Promise<void> {
    if (!token || !me?.targetDomain) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(`/target-domains/${me.targetDomain.id}/verify-demo`, { method: "POST", body: JSON.stringify({}) }, token);
      await refreshAll(token);
      setSuccess("TargetDomain marcado como demo_verified.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleCreateCustomerDomain(): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      await apiFetch("/sending-domains", {
        method: "POST",
        body: JSON.stringify({ mode: "customer_domain", domain: customerDomainInput }),
      }, token);
      await refreshAll(token);
      setSuccess("Customer sending domain añadido en estado pending.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleVerifyStub(domainId: string): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(`/sending-domains/${domainId}/verify-stub`, {
        method: "POST",
        body: JSON.stringify({}),
      }, token);
      await refreshAll(token);
      setSuccess("Customer sending domain marcado como stub_verified.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleUpdateDefaultMode(mode: SendingMode): Promise<void> {
    if (!token || !me) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(`/tenants/${me.tenant.id}/default-sending-mode`, {
        method: "PATCH",
        body: JSON.stringify({ defaultSendingMode: mode }),
      }, token);
      await refreshAll(token);
      setSuccess(`Default sending mode actualizado a ${mode}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleImportEmployees(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }
    clearNotices();

    try {
      const response = await apiFetch<{ importedCount: number; errors: string[] }>(
        "/employees/import-csv",
        {
          method: "POST",
          body: JSON.stringify({ csv: csvInput }),
        },
        token,
      );
      await refreshAll(token);
      setSuccess(`Import completado. Total empleados en tenant: ${response.importedCount}.`);
      if (response.errors.length > 0) {
        setError(`Import con advertencias: ${response.errors.join(" | ")}`);
      }
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleCreateCampaign(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !selectedSendingDomainId) {
      return;
    }
    clearNotices();

    try {
      const campaign = await apiFetch<Campaign>(
        "/campaigns",
        {
          method: "POST",
          body: JSON.stringify({
            name: campaignName,
            templateName,
            sendingMode: campaignSendingMode,
            sendingDomainId: selectedSendingDomainId,
          }),
        },
        token,
      );
      await refreshAll(token);
      setSelectedCampaignId(campaign.id);
      await loadRecipients(token, campaign.id);
      setSuccess("Campaign creada en estado draft.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handlePreviewCampaign(): Promise<void> {
    if (!token || !selectedCampaignId) {
      return;
    }
    clearNotices();

    try {
      const [previewData, trainingData] = await Promise.all([
        apiFetch<{ emailPreview: { subject: string; body: string; badge: string } }>(
          `/campaigns/${selectedCampaignId}/preview`,
          { method: "POST", body: JSON.stringify({}) },
          token,
        ),
        apiFetch<{
          module: { title: string; summary: string; points: string[] };
          quiz: Array<{ id: string; question: string; options: string[] }>;
          badge: string;
        }>(`/campaigns/${selectedCampaignId}/training-preview`, {}, token),
      ]);

      setPreviewPayload(previewData);
      setTrainingPreview(trainingData);
      await refreshAll(token);
      setSuccess("Preview de campaña y training disponible (demo-only).");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleScheduleCampaign(): Promise<void> {
    if (!token || !selectedCampaignId) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(`/campaigns/${selectedCampaignId}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }),
      }, token);
      await refreshAll(token);
      setSuccess("Campaign programada.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleDispatchCampaign(): Promise<void> {
    if (!token || !selectedCampaignId) {
      return;
    }
    clearNotices();

    try {
      const response = await apiFetch<{ attempted: number; sent: number; failed: number }>(
        `/campaigns/${selectedCampaignId}/dispatch`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        token,
      );
      await refreshAll(token);
      await loadRecipients(token, selectedCampaignId);
      setSuccess(`Dispatch completado. attempted=${response.attempted}, sent=${response.sent}, failed=${response.failed}`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleSimulateClick(): Promise<void> {
    if (!token || !selectedRecipient) {
      return;
    }
    clearNotices();

    try {
      const result = await apiFetch<{ trainingSessionId: string }>(
        "/events/click",
        {
          method: "POST",
          body: JSON.stringify({ trackingToken: selectedRecipient.trackingToken }),
        },
        token,
      );
      setActiveTrainingSessionId(result.trainingSessionId);
      setSuccess("Evento click registrado y training iniciado.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleSimulateReport(): Promise<void> {
    if (!token || !selectedRecipient) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(
        "/events/report-phish",
        {
          method: "POST",
          body: JSON.stringify({ trackingToken: selectedRecipient.trackingToken }),
        },
        token,
      );
      setSuccess("Evento reportado registrado.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleSimulateCredentialSubmit(): Promise<void> {
    if (!token || !selectedRecipient) {
      return;
    }
    clearNotices();

    try {
      const result = await apiFetch<{ storedMetadata: Record<string, unknown> }>(
        "/events/credential-submit-simulated",
        {
          method: "POST",
          body: JSON.stringify({
            trackingToken: selectedRecipient.trackingToken,
            username: credentialUsername,
            password: credentialPassword,
          }),
        },
        token,
      );
      setCredentialPassword("");
      setSuccess(`Credential submit simulado guardado sin password. ${JSON.stringify(result.storedMetadata)}`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleTrainingStart(): Promise<void> {
    if (!token || !selectedRecipient) {
      return;
    }
    clearNotices();

    try {
      const response = await apiFetch<{
        sessionId: string;
        module: { title: string; summary: string; points: string[] };
        quiz: Array<{ id: string; question: string; options: string[] }>;
      }>(
        "/training/start",
        {
          method: "POST",
          body: JSON.stringify({ trackingToken: selectedRecipient.trackingToken }),
        },
        token,
      );
      setActiveTrainingSessionId(response.sessionId);
      setTrainingPreview({ module: response.module, quiz: response.quiz, badge: "stage2-live" });
      setSuccess(`Training iniciado: ${response.sessionId}`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleTrainingComplete(): Promise<void> {
    if (!token || !activeTrainingSessionId) {
      return;
    }
    clearNotices();

    try {
      const response = await apiFetch<{ score: number; passed: boolean }>(
        `/training/${activeTrainingSessionId}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ answers: [0, 1] }),
        },
        token,
      );
      setTrainingResult(response);
      setSuccess(`Training completado. score=${response.score} passed=${response.passed}`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleWebhook(eventType: "delivered" | "open" | "click"): Promise<void> {
    if (!selectedRecipient?.providerMessageId) {
      setError("Selecciona un recipient con providerMessageId.");
      return;
    }
    clearNotices();

    try {
      const response = await apiFetch<{
        processed: number;
        duplicateWebhook: number;
        duplicateEvent: number;
        unknownMessage: number;
        createdEvents: number;
      }>("/webhooks/email-provider", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              provider: "mock",
              eventId: makeEventId(`mock-${eventType}`),
              messageId: selectedRecipient.providerMessageId,
              eventType,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      });
      setWebhookSummary(response);
      setSuccess(`Webhook ${eventType} procesado.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleLoadTimeline(): Promise<void> {
    if (!token || !selectedEmployeeId) {
      return;
    }
    clearNotices();

    try {
      const payload = await apiFetch<TimelinePayload>(`/employees/${selectedEmployeeId}/timeline?scope=all`, {}, token);
      setTimeline(payload);
      setSuccess("Timeline cargado.");
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleLoadRiskOverview(): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      const payload = await apiFetch<RiskOverview>("/risk/overview", {}, token);
      setRiskOverview(payload);
      setSuccess(`Risk overview cargado. Score=${payload.score} (${payload.level}).`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleEvaluateCampaignRisk(): Promise<void> {
    if (!token || !selectedCampaignId) {
      return;
    }
    clearNotices();

    try {
      const payload = await apiFetch<{
        evaluationReady: boolean;
        createdViolations: PolicyViolation[];
        matchedViolations: PolicyViolation[];
      }>(
        `/campaigns/${selectedCampaignId}/evaluate-risk`,
        {
          method: "POST",
          body: JSON.stringify({ note: "manual evaluation from ui" }),
        },
        token,
      );
      await refreshAll(token);
      await handleLoadRiskOverview();
      setSuccess(
        `Evaluación completada. ready=${payload.evaluationReady}, created=${payload.createdViolations.length}, matched=${payload.matchedViolations.length}.`,
      );
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleReviewPolicyViolation(
    violationId: string,
    decision: "approve_for_restriction" | "dismiss",
  ): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(
        `/ops/policy-violations/${violationId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            note: riskReviewNote,
          }),
        },
        token,
      );
      await refreshAll(token);
      setSuccess(`Policy violation revisada: ${decision}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handleRestrictTenant(restricted: boolean): Promise<void> {
    if (!token || !me) {
      return;
    }
    clearNotices();

    if (restricted && !approvedViolation) {
      setError("Necesitas una policy violation en estado approved_for_restriction antes de restringir.");
      return;
    }

    try {
      await apiFetch(
        `/ops/tenants/${me.tenant.id}/restrict`,
        {
          method: "POST",
          body: JSON.stringify({
            restricted,
            reason: restrictionReason,
            policyViolationId: restricted ? approvedViolation?.id : undefined,
          }),
        },
        token,
      );
      await refreshAll(token);
      await handleLoadRiskOverview();
      setSuccess(`Tenant status actualizado: ${restricted ? "restricted" : "active"}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handlePauseGlobal(paused: boolean): Promise<void> {
    if (!token) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(
        "/ops/pause-global",
        {
          method: "POST",
          body: JSON.stringify({ paused, reason: globalPauseReason }),
        },
        token,
      );
      await refreshAll(token);
      setSuccess(`Global pause actualizado: ${paused}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handlePauseTenant(paused: boolean): Promise<void> {
    if (!token || !me) {
      return;
    }
    clearNotices();

    try {
      await apiFetch(
        `/ops/tenants/${me.tenant.id}/pause`,
        {
          method: "POST",
          body: JSON.stringify({ paused, reason: tenantPauseReason }),
        },
        token,
      );
      await refreshAll(token);
      setSuccess(`Tenant pause actualizado: ${paused}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  async function handlePauseCampaign(paused: boolean): Promise<void> {
    if (!token || !selectedCampaignId) {
      return;
    }

    clearNotices();
    try {
      await apiFetch(
        `/campaigns/${selectedCampaignId}/pause`,
        {
          method: "POST",
          body: JSON.stringify({ paused, reason: campaignPauseReason }),
        },
        token,
      );
      await refreshAll(token);
      setSuccess(`Campaign pause actualizado: ${paused}.`);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  }

  return (
    <main>
      <div className="card">
        <h1>EntornoSeguro - Stage 3 Demo</h1>
        <p className="muted">
          Flujo visible: signup - setup domains - import CSV - campaign preview - schedule - dispatch - events - training - timeline - risk review.
        </p>
        <div className="inline">
          <span className="badge">demo-only</span>
          <span className="muted">Lifecycle por defecto: sandbox</span>
        </div>
        {statusMessage ? <p className="success">{statusMessage}</p> : null}
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
      </div>

      {!token ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>1) Signup tenant</h2>
          <form onSubmit={handleSignup} className="grid">
            <div>
              <label htmlFor="company">Company name</label>
              <input id="company" value={signupCompany} onChange={(event) => setSignupCompany(event.target.value)} />
            </div>
            <div>
              <label htmlFor="email">Owner email</label>
              <input id="email" value={signupEmail} onChange={(event) => setSignupEmail(event.target.value)} />
            </div>
            <div>
              <button type="submit">Create sandbox tenant</button>
            </div>
          </form>
        </section>
      ) : null}

      {token && me ? (
        <div className="grid" style={{ marginTop: 16 }}>
          <section className="card">
            <h2>2) Setup domains</h2>
            <p className="muted">
              Tenant: <strong>{me.tenant.name}</strong> ({me.admin.role}) - Default sending mode: <strong>{me.tenant.defaultSendingMode}</strong>
            </p>

            <div>
              <h3>TargetDomain (1 per tenant)</h3>
              {!me.targetDomain ? (
                <>
                  <label htmlFor="target-domain">Target domain</label>
                  <input
                    id="target-domain"
                    value={targetDomainInput}
                    onChange={(event) => setTargetDomainInput(event.target.value)}
                  />
                  <button type="button" onClick={handleCreateTargetDomain}>
                    Create target domain
                  </button>
                </>
              ) : (
                <>
                  <p>
                    {me.targetDomain.domain} - <strong>{me.targetDomain.verificationStatus}</strong>
                  </p>
                  {me.targetDomain.verificationStatus !== "demo_verified" ? (
                    <button type="button" onClick={handleVerifyTargetDomain}>
                      Verify demo
                    </button>
                  ) : null}
                </>
              )}
            </div>

            <div>
              <h3>SendingDomain dedicated (tenant subdomain)</h3>
              <ul className="list">
                {me.sendingDomains
                  .filter((domain) => domain.mode === "dedicated")
                  .map((domain) => (
                    <li key={domain.id}>
                      <div>{domain.domain}</div>
                      <span className="badge">{domain.verificationStatus}</span>
                    </li>
                  ))}
              </ul>
            </div>

            <div>
              <h3>SendingDomain customer_domain (stub)</h3>
              <label htmlFor="customer-domain">Customer domain</label>
              <input
                id="customer-domain"
                value={customerDomainInput}
                onChange={(event) => setCustomerDomainInput(event.target.value)}
              />
              <button type="button" onClick={handleCreateCustomerDomain}>
                Add customer domain (stub)
              </button>

              <ul className="list">
                {me.sendingDomains
                  .filter((domain) => domain.mode === "customer_domain")
                  .map((domain) => (
                    <li key={domain.id}>
                      <div className="inline" style={{ justifyContent: "space-between" }}>
                        <span>{domain.domain}</span>
                        <span className="badge">{domain.verificationStatus}</span>
                      </div>
                      {domain.verificationStatus !== "stub_verified" ? (
                        <button type="button" className="secondary" onClick={() => handleVerifyStub(domain.id)}>
                          Mark stub_verified
                        </button>
                      ) : null}
                    </li>
                  ))}
              </ul>

              <div className="inline">
                <button type="button" className="secondary" onClick={() => handleUpdateDefaultMode("dedicated")}>
                  Set default dedicated
                </button>
                <button type="button" className="secondary" onClick={() => handleUpdateDefaultMode("customer_domain")}>
                  Set default customer_domain
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>3) Import employees CSV</h2>
            <form onSubmit={handleImportEmployees}>
              <label htmlFor="csv">CSV content</label>
              <textarea id="csv" value={csvInput} onChange={(event) => setCsvInput(event.target.value)} />
              <button type="submit">Import CSV</button>
            </form>
            <p className="muted">Employees loaded: {employees.length}</p>
            <ul className="list">
              {employees.slice(0, 5).map((employee) => (
                <li key={employee.id}>
                  <strong>{employee.fullName}</strong> ({employee.email}) <span className="badge">{employee.dataClass}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>4) Campaign + training preview</h2>
            <form onSubmit={handleCreateCampaign}>
              <label htmlFor="campaign-name">Campaign name</label>
              <input id="campaign-name" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />

              <label htmlFor="template-name">Template name</label>
              <input id="template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />

              <label htmlFor="sending-mode">Sending mode</label>
              <select
                id="sending-mode"
                value={campaignSendingMode}
                onChange={(event) => setCampaignSendingMode(event.target.value as SendingMode)}
              >
                <option value="dedicated">dedicated</option>
                <option value="customer_domain">customer_domain</option>
              </select>

              <label htmlFor="sending-domain">Sending domain</label>
              <select
                id="sending-domain"
                value={selectedSendingDomainId}
                onChange={(event) => setSelectedSendingDomainId(event.target.value)}
              >
                {sendingDomainOptions.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.domain} ({domain.verificationStatus})
                  </option>
                ))}
              </select>

              <button type="submit" disabled={!selectedSendingDomainId}>
                Create campaign draft
              </button>
            </form>

            <label htmlFor="campaign-select">Select campaign</label>
            <select id="campaign-select" value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)}>
              <option value="">Select...</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} ({campaign.status})
                </option>
              ))}
            </select>

            <div className="inline">
              <button type="button" className="secondary" onClick={handlePreviewCampaign} disabled={!selectedCampaignId}>
                Preview campaign + training
              </button>
              <button type="button" className="secondary" onClick={handleScheduleCampaign} disabled={!selectedCampaignId}>
                Schedule
              </button>
              <button type="button" className="secondary" onClick={handleDispatchCampaign} disabled={!selectedCampaignId}>
                Dispatch
              </button>
            </div>

            {previewPayload ? (
              <div>
                <h3>Email preview</h3>
                <p>
                  <strong>{previewPayload.emailPreview.subject}</strong>
                </p>
                <p className="muted">{previewPayload.emailPreview.body}</p>
                <span className="badge">{previewPayload.emailPreview.badge}</span>
              </div>
            ) : null}

            {trainingPreview ? (
              <div>
                <h3>Training preview</h3>
                <p>
                  <strong>{trainingPreview.module.title}</strong>
                </p>
                <p className="muted">{trainingPreview.module.summary}</p>
                <ul className="list">
                  {trainingPreview.module.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <h3>Microquiz preview</h3>
                <ul className="list">
                  {trainingPreview.quiz.map((question) => (
                    <li key={question.id}>
                      <strong>{question.question}</strong>
                      <div className="muted">{question.options.join(" | ")}</div>
                    </li>
                  ))}
                </ul>
                <span className="badge">{trainingPreview.badge}</span>
              </div>
            ) : null}

            {currentCampaign ? (
              <p className="muted">
                Campaign actual: {currentCampaign.status} / data scope: {currentCampaign.dataScope} / sent: {currentCampaign.recipientStats?.sent ?? 0}
              </p>
            ) : null}
          </section>

          <section className="card">
            <h2>5) Stage 2: recipients, events y training real</h2>
            <label htmlFor="recipient-select">Recipient</label>
            <select
              id="recipient-select"
              value={selectedRecipientId}
              onChange={(event) => setSelectedRecipientId(event.target.value)}
            >
              <option value="">Select...</option>
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.email} ({recipient.sendStatus})
                </option>
              ))}
            </select>

            {selectedRecipient ? (
              <>
                <p className="muted">trackingToken: {selectedRecipient.trackingToken}</p>
                <p className="muted">providerMessageId: {selectedRecipient.providerMessageId ?? "-"}</p>
              </>
            ) : null}

            <div className="inline">
              <button type="button" className="secondary" onClick={handleSimulateClick} disabled={!selectedRecipient}>
                Simulate click
              </button>
              <button type="button" className="secondary" onClick={handleSimulateReport} disabled={!selectedRecipient}>
                Simulate report
              </button>
            </div>

            <div>
              <label htmlFor="credential-username">Credential username</label>
              <input
                id="credential-username"
                value={credentialUsername}
                onChange={(event) => setCredentialUsername(event.target.value)}
              />
              <label htmlFor="credential-password">Credential password (never persisted)</label>
              <input
                id="credential-password"
                value={credentialPassword}
                onChange={(event) => setCredentialPassword(event.target.value)}
              />
              <button type="button" className="secondary" onClick={handleSimulateCredentialSubmit} disabled={!selectedRecipient}>
                Simulate credential submit
              </button>
            </div>

            <div className="inline">
              <button type="button" className="secondary" onClick={handleTrainingStart} disabled={!selectedRecipient}>
                Start training
              </button>
              <button type="button" className="secondary" onClick={handleTrainingComplete} disabled={!activeTrainingSessionId}>
                Complete training
              </button>
            </div>

            {activeTrainingSessionId ? <p className="muted">Training session: {activeTrainingSessionId}</p> : null}
            {trainingResult ? (
              <p className="muted">
                Result: score {trainingResult.score} / passed {String(trainingResult.passed)}
              </p>
            ) : null}

            <h3>Webhook mock (idempotente)</h3>
            <div className="inline">
              <button
                type="button"
                className="secondary"
                onClick={() => handleWebhook("delivered")}
                disabled={!selectedRecipient?.providerMessageId}
              >
                webhook delivered
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleWebhook("open")}
                disabled={!selectedRecipient?.providerMessageId}
              >
                webhook open
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleWebhook("click")}
                disabled={!selectedRecipient?.providerMessageId}
              >
                webhook click
              </button>
            </div>

            {webhookSummary ? (
              <p className="muted">
                processed={webhookSummary.processed}, duplicateWebhook={webhookSummary.duplicateWebhook}, duplicateEvent={webhookSummary.duplicateEvent}
              </p>
            ) : null}
          </section>

          <section className="card">
            <h2>6) Timeline</h2>
            <label htmlFor="employee-select">Employee</label>
            <select
              id="employee-select"
              value={selectedEmployeeId}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
            >
              <option value="">Select...</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={handleLoadTimeline} disabled={!selectedEmployeeId}>
              Load timeline
            </button>

            {timeline ? (
              <>
                <span className="badge">{timeline.badge}</span>
                <ul className="list">
                  {timeline.events.map((event) => (
                    <li key={`${event.type}-${event.at}`}>
                      <strong>{event.type}</strong>
                      <div className="muted">{new Date(event.at).toLocaleString()}</div>
                      <div className="muted">{event.detail}</div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="card">
            <h2>7) Stage 3: risk + manual enforcement</h2>
            <p className="muted">
              Score explicable con umbrales conservadores. Restricción de tenant solo con revisión manual.
            </p>
            <p>
              Tenant status: <strong>{me.tenant.status}</strong>
            </p>
            <div className="inline">
              <button type="button" className="secondary" onClick={handleLoadRiskOverview}>
                Load risk overview
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleEvaluateCampaignRisk}
                disabled={!selectedCampaignId}
              >
                Evaluate selected campaign
              </button>
            </div>

            {riskOverview ? (
              <div>
                <p className="muted">
                  Score: <strong>{riskOverview.score}</strong> ({riskOverview.level})
                </p>
                <p className="muted">
                  click={riskOverview.metrics.clickRate} | credential submit={riskOverview.metrics.credentialSubmitRate} | report=
                  {riskOverview.metrics.reportRate} | completion={riskOverview.metrics.trainingCompletionRate}
                </p>
                <p className="muted">
                  repeat susceptibility={riskOverview.metrics.repeatSusceptibilityRate} | median time to report=
                  {riskOverview.metrics.medianTimeToReportMinutes ?? "-"} min | open (secondary)={riskOverview.metrics.openRate}
                </p>
                <p className="muted">
                  unresolved violations={riskOverview.unresolvedViolations.total} (high={riskOverview.unresolvedViolations.highSeverity})
                </p>
              </div>
            ) : null}

            <h3>Policy violations</h3>
            {policyViolations.length === 0 ? <p className="muted">No policy violations yet.</p> : null}
            <ul className="list">
              {policyViolations.slice(0, 8).map((violation) => (
                <li key={violation.id}>
                  <div>
                    <strong>{violation.type}</strong> ({violation.severity}) - {violation.status}
                  </div>
                  <div className="muted">
                    observed={violation.observed} threshold={violation.threshold} sample={violation.sampleSize}
                  </div>
                  <div className="muted">{violation.summary}</div>
                  {violation.status === "open" ? (
                    <div className="inline">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleReviewPolicyViolation(violation.id, "approve_for_restriction")}
                      >
                        Approve for restriction
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleReviewPolicyViolation(violation.id, "dismiss")}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <label htmlFor="risk-review-note">Review note</label>
            <input
              id="risk-review-note"
              value={riskReviewNote}
              onChange={(event) => setRiskReviewNote(event.target.value)}
            />

            <label htmlFor="restriction-reason">Restriction reason</label>
            <input
              id="restriction-reason"
              value={restrictionReason}
              onChange={(event) => setRestrictionReason(event.target.value)}
            />
            <div className="inline">
              <button
                type="button"
                className="danger"
                onClick={() => handleRestrictTenant(true)}
                disabled={me.tenant.status === "restricted" || !approvedViolation}
              >
                Restrict tenant
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleRestrictTenant(false)}
                disabled={me.tenant.status !== "restricted"}
              >
                Lift tenant restriction
              </button>
            </div>
            <p className="muted">
              Restrict button requires one violation reviewed as <strong>approved_for_restriction</strong>.
            </p>
          </section>

          <section className="card">
            <h2>8) Pause controls (global {">"} tenant {">"} campaign)</h2>
            <p className="muted">
              Bloquean nuevos envíos/programaciones; no bloquean ingestión de eventos.
            </p>
            <p>
              Global paused: <strong>{String(me.system.globalSendPaused)}</strong>
            </p>
            <p>
              Tenant paused: <strong>{String(me.tenant.sendPaused)}</strong>
            </p>

            <div>
              <label htmlFor="global-reason">Global pause reason</label>
              <input
                id="global-reason"
                value={globalPauseReason}
                onChange={(event) => setGlobalPauseReason(event.target.value)}
              />
              <div className="inline">
                <button type="button" className="danger" onClick={() => handlePauseGlobal(true)}>
                  Pause global
                </button>
                <button type="button" className="secondary" onClick={() => handlePauseGlobal(false)}>
                  Resume global
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="tenant-reason">Tenant pause reason</label>
              <input
                id="tenant-reason"
                value={tenantPauseReason}
                onChange={(event) => setTenantPauseReason(event.target.value)}
              />
              <div className="inline">
                <button type="button" className="danger" onClick={() => handlePauseTenant(true)}>
                  Pause tenant
                </button>
                <button type="button" className="secondary" onClick={() => handlePauseTenant(false)}>
                  Resume tenant
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="campaign-reason">Campaign pause reason</label>
              <input
                id="campaign-reason"
                value={campaignPauseReason}
                onChange={(event) => setCampaignPauseReason(event.target.value)}
              />
              <div className="inline">
                <button type="button" className="danger" onClick={() => handlePauseCampaign(true)} disabled={!selectedCampaignId}>
                  Pause campaign
                </button>
                <button type="button" className="secondary" onClick={() => handlePauseCampaign(false)} disabled={!selectedCampaignId}>
                  Resume campaign
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>9) Audit log (critical actions)</h2>
            <ul className="list">
              {auditItems.slice(0, 12).map((item, index) => (
                <li key={`${item.action}-${index}`}>
                  <strong>{item.action}</strong>
                  <div className="muted">{new Date(item.createdAt).toLocaleString()}</div>
                  {item.reason ? <div className="muted">Reason: {item.reason}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </main>
  );
}
