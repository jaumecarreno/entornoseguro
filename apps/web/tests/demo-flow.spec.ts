import { expect, test } from "@playwright/test";

test("stage2 demo flow is visible end-to-end with dispatch and training", async ({ page }) => {
  const stamp = Date.now();
  const company = `Acme ${stamp}`;
  const ownerEmail = `owner${stamp}@acme.test`;
  const targetDomain = `acme${stamp}.test`;

  await page.goto("/");

  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByRole("button", { name: "Create sandbox tenant" }).click();

  await expect(page.getByRole("heading", { name: "2) Setup domains" })).toBeVisible();

  await page.getByLabel("Target domain").fill(targetDomain);
  await page.getByRole("button", { name: "Create target domain" }).click();
  await page.getByRole("button", { name: "Verify demo" }).click();
  await expect(page.getByText("demo_verified", { exact: true })).toBeVisible();

  const csv = `email,full_name,department\nalice${stamp}@demo.local,Alice Ruiz,Finance\nbob${stamp}@demo.local,Bob Vidal,Sales`;
  await page.getByLabel("CSV content").fill(csv);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByText("Employees loaded: 2")).toBeVisible();

  await page.getByRole("button", { name: "Create campaign draft" }).click();
  await page.getByRole("button", { name: "Preview campaign + training" }).click();
  await expect(page.getByRole("heading", { name: "Training preview", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Schedule" }).click();
  await page.getByRole("button", { name: "Dispatch (Stage 2)" }).click();
  await expect(page.getByText("Dispatch completado", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Simulate click" }).click();
  await page.getByRole("button", { name: "Start training" }).click();
  await page.getByRole("button", { name: "Complete training" }).click();

  await page.getByRole("button", { name: "Load timeline" }).click();
  await expect(page.getByRole("heading", { name: "6) Timeline" })).toBeVisible();
});
