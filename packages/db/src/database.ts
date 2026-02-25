import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseData } from "./models.js";

const defaultData: DatabaseData = {
  system: {
    globalSendPaused: false,
  },
  tenants: [],
  adminUsers: [],
  targetDomains: [],
  sendingDomains: [],
  employees: [],
  campaigns: [],
  campaignRecipients: [],
  recipientEvents: [],
  trainingSessions: [],
  quizAttempts: [],
  processedWebhooks: [],
  auditLogs: [],
  operationalControls: [],
};

function normalizeParsedData(parsed: Partial<DatabaseData> | null | undefined): DatabaseData {
  return {
    system: {
      globalSendPaused: parsed?.system?.globalSendPaused ?? false,
    },
    tenants: parsed?.tenants ?? [],
    adminUsers: parsed?.adminUsers ?? [],
    targetDomains: parsed?.targetDomains ?? [],
    sendingDomains: parsed?.sendingDomains ?? [],
    employees: parsed?.employees ?? [],
    campaigns: parsed?.campaigns ?? [],
    campaignRecipients: parsed?.campaignRecipients ?? [],
    recipientEvents: parsed?.recipientEvents ?? [],
    trainingSessions: parsed?.trainingSessions ?? [],
    quizAttempts: parsed?.quizAttempts ?? [],
    processedWebhooks: parsed?.processedWebhooks ?? [],
    auditLogs: parsed?.auditLogs ?? [],
    operationalControls: parsed?.operationalControls ?? [],
  };
}

export class JsonDatabase {
  private readonly filePath: string;
  private loaded = false;
  private data: DatabaseData = structuredClone(defaultData);

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<DatabaseData>;
      this.data = normalizeParsedData(parsed);
      await this.flush();
    } catch {
      this.data = structuredClone(defaultData);
      await this.flush();
    }

    this.loaded = true;
  }

  async read<T>(reader: (data: DatabaseData) => T): Promise<T> {
    await this.init();
    return reader(structuredClone(this.data));
  }

  async write<T>(writer: (data: DatabaseData) => T | Promise<T>): Promise<T> {
    await this.init();
    const result = await writer(this.data);
    await this.flush();
    return result;
  }

  async reset(): Promise<void> {
    this.data = structuredClone(defaultData);
    await this.flush();
  }

  newId(): string {
    return randomUUID();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  private async flush(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
