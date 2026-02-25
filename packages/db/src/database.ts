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
  auditLogs: [],
  operationalControls: [],
};

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
      this.data = JSON.parse(content) as DatabaseData;
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

  async write<T>(writer: (data: DatabaseData) => T): Promise<T> {
    await this.init();
    const result = writer(this.data);
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
