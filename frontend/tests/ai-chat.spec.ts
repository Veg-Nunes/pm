import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { columnByTitle, login } from "./helpers";

// Mirrors backend/tests/test_ai.py's requires_api_key marker: this test
// makes a real OpenRouter call (through the real backend), so it's skipped
// when the root .env has no key configured (e.g. a fresh clone, or CI
// without the secret) rather than failing.
const hasApiKey = (() => {
  try {
    const envContent = readFileSync(
      path.resolve(__dirname, "..", "..", ".env"),
      "utf-8"
    );
    return /OPENROUTER_API_KEY=\S+/.test(envContent);
  } catch {
    return false;
  }
})();

test.skip(!hasApiKey, "requires OPENROUTER_API_KEY in the root .env");

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("adding a card via chat appears on the board without a manual reload", async ({
  page,
}) => {
  const cardTitle = `Playwright AI card ${Date.now()}`;

  await page
    .getByLabel("Chat message")
    .fill(`Add a card called "${cardTitle}" to the Backlog column.`);
  await page.getByRole("button", { name: /send/i }).click();

  // The assistant's reply lands in the chat pane once the real OpenRouter
  // call completes; the board update (if any) is applied at the same time,
  // from the same response - no page reload or extra fetch involved. The
  // model's exact wording varies, so wait out the full "Thinking..."
  // loading cycle rather than matching specific reply words.
  // dnd-kit renders its own `role="status"` live region for drag
  // announcements, so scope this to the chat pane's own indicator.
  const thinking = page.getByTestId("chat-messages").getByRole("status");
  await expect(thinking).toBeVisible();
  await expect(thinking).toBeHidden({ timeout: 20_000 });

  const backlog = await columnByTitle(page, "Backlog");
  await expect(backlog.getByText(cardTitle)).toBeVisible();

  // Clean up so repeated local runs (outside CI's fresh-db e2e run) don't
  // accumulate AI-created cards.
  await backlog.locator(`button[aria-label="Delete ${cardTitle}"]`).click();
  await expect(backlog.getByText(cardTitle)).not.toBeVisible();
});

test("a question that doesn't require a board change leaves the board untouched", async ({
  page,
}) => {
  const backlog = await columnByTitle(page, "Backlog");
  const cardsBefore = await backlog.getByTestId(/^card-/).count();

  await page
    .getByLabel("Chat message")
    .fill("What columns are on my board? Don't change anything.");
  await page.getByRole("button", { name: /send/i }).click();

  // dnd-kit renders its own `role="status"` live region for drag
  // announcements, so scope this to the chat pane's own indicator.
  const thinking = page.getByTestId("chat-messages").getByRole("status");
  await expect(thinking).toBeVisible();
  await expect(thinking).toBeHidden({ timeout: 20_000 });

  await expect(backlog.getByTestId(/^card-/)).toHaveCount(cardsBefore);
});
