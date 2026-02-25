import { randomUUID } from "node:crypto";

export interface SendSimulationEmailInput {
  tenantId: string;
  campaignId: string;
  campaignRecipientId: string;
  toEmail: string;
  toName: string;
  fromDomain: string;
  templateName: string;
  trackingToken: string;
}

export interface SendSimulationEmailResult {
  provider: string;
  messageId: string;
  acceptedAt: string;
}

export interface EmailProviderAdapter {
  sendSimulationEmail(input: SendSimulationEmailInput): Promise<SendSimulationEmailResult>;
}

class MockEmailProviderAdapter implements EmailProviderAdapter {
  async sendSimulationEmail(_input: SendSimulationEmailInput): Promise<SendSimulationEmailResult> {
    return {
      provider: "mock",
      messageId: `mock-${randomUUID()}`,
      acceptedAt: new Date().toISOString(),
    };
  }
}

export function createEmailProviderAdapter(kind: string = "mock"): EmailProviderAdapter {
  if (kind === "mock") {
    return new MockEmailProviderAdapter();
  }

  // Stage 2 keeps provider strategy simple and testable.
  return new MockEmailProviderAdapter();
}
