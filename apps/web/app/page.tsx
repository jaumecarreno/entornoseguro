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
  status: "draft" | "previewed" | "scheduled" | "paused";
  sendingMode: SendingMode;
  sendingDomainId: string;
  dataScope: "demo_only" | "real";
  scheduledAt: string | null;
};

type TimelinePayload = {
  badge: string;
  events: Array<{ type: string; at: string; detail: string; dataClass: string }>;
};

const defaultCsv = `email,full_name,department\nalice@demo.local,Alice Ruiz,Finance\nbob@demo.local,Bob Vidal,Sales`;

export default function HomePage() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [auditItems, setAuditItems] = useState<Array<{ action: string; createdAt: string; reason: string | null }>>([]);

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

  const currentCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

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
    const [meData, employeesData, campaignsData, auditData] = await Promise.all([
      apiFetch<MeResponse>("/me", {}, sessionToken),
      apiFetch<{ items: Employee[] }>("/employees", {}, sessionToken),
      apiFetch<{ items: Campaign[] }>("/campaigns", {}, sessionToken),
      apiFetch<{ items: Array<{ action: string; createdAt: string; reason: string | null }> }>(
        "/audit-logs",
        {},
        sessionToken,
      ),
    ]);

    setMe(meData);
    setEmployees(employeesData.items);
    setCampaigns(campaignsData.items);
    setAuditItems(auditData.items);

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
      setSuccess("Campaign programada sin envío real (Etapa 1). ");
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
      const payload = await apiFetch<TimelinePayload>(`/employees/${selectedEmployeeId}/timeline?scope=demo`, {}, token);
      setTimeline(payload);
      setSuccess("Timeline demo-only cargado.");
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
        <h1>EntornoSeguro - Stage 1 Demo</h1>
        <p className="muted">
          Flujo visible: signup - setup domains - import CSV - campaign preview - training preview - timeline mock.
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
                Schedule (no send)
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
                Campaign actual: {currentCampaign.status} / data scope: {currentCampaign.dataScope}
              </p>
            ) : null}
          </section>

          <section className="card">
            <h2>5) Timeline mock demo-only</h2>
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
              Load timeline demo
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
            <h2>6) Pause controls (global {">"} tenant {">"} campaign)</h2>
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
            <h2>7) Audit log (critical actions)</h2>
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
