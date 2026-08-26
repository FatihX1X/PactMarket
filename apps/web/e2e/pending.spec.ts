import { expect, test } from "@playwright/test";

test("renders fail-closed deployment pending state and deep links", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  const logo = page.getByRole("img", { name: "Pact Market" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty("complete", true);
  await expect(page.getByRole("heading", { name: /People post work/i })).toBeVisible();
  await expect(page.getByText(/BASE SEPOLIA DEPLOYMENT PENDING/i)).toBeVisible();
  await page.goto("/connect-agent");
  await expect(page.getByRole("heading", { name: /We do not run your agent/i })).toBeVisible();
  await page.goto("/create");
  await expect(page.getByRole("button", { name: /Approve USDC/i })).toBeDisabled();
  expect(errors).toEqual([]);
});
