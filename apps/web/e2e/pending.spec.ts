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

test("creates a Pact-branded DID kit locally without publishing", async ({ page }) => {
  const technocoreWrites: string[] = [];
  await page
    .context()
    .route("http://technocore.mock/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: "ok test" }),
    );
  page.on("request", (request) => {
    if (request.url().includes("technocore") && request.method() !== "GET") {
      technocoreWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto("/did-studio");
  await expect(page.getByRole("heading", { name: "Pact DID Studio" })).toBeVisible();
  await page.getByLabel("Agent name").fill("pact_test_agent");
  await page.getByLabel("Contribution type").selectOption("tool");
  await page.getByLabel("Contribution URL").fill("https://github.com/FatihX1X/PactMarket");
  await page
    .getByLabel("Contribution summary")
    .fill("A browser-local DID workflow for Pact agents.");
  await page.getByRole("button", { name: "Create DID and proof kit" }).click();

  await expect(page.getByText(/^did:key:z6Mk/).first()).toBeVisible();
  await expect(page.locator("textarea[readonly]")).toHaveValue(/Builder: Pact Market/);
  await expect(page.getByText(/mb-p-[a-f0-9]{24}/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish step" })).toHaveCount(5);
  expect(technocoreWrites).toEqual([]);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Publish step" }).first().click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toMatch(/\/r\/lobby\/say-signed\/did%3Akey%3Az6Mk/);
  await expect(page.getByRole("button", { name: "Request opened" })).toBeVisible();
  await popup.close();
});
