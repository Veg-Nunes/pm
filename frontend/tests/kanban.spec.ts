import { expect, test } from "@playwright/test";
import { columnByTitle, expectColumnTitles, login, waitForBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("loads the seeded kanban board", async ({ page }) => {
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await expectColumnTitles(page, [
    "Backlog",
    "Discovery",
    "In Progress",
    "Review",
    "Done",
  ]);
});

test("adds a card and it survives a reload", async ({ page }) => {
  const backlog = await columnByTitle(page, "Backlog");
  await backlog.getByRole("button", { name: /add a card/i }).click();
  await backlog.getByPlaceholder("Card title").fill("Playwright card");
  await backlog.getByPlaceholder("Details").fill("Added via e2e.");
  await backlog.getByRole("button", { name: /add card/i }).click();
  await expect(backlog.getByText("Playwright card")).toBeVisible();

  await page.reload();
  await waitForBoard(page);

  const backlogAfterReload = await columnByTitle(page, "Backlog");
  await expect(backlogAfterReload.getByText("Playwright card")).toBeVisible();
});

test("renames a column and it survives a reload", async ({ page }) => {
  const done = await columnByTitle(page, "Done");
  const titleInput = done.getByLabel("Column title");
  await titleInput.fill("Complete");
  await titleInput.blur();
  await expect(titleInput).toHaveValue("Complete");

  await page.reload();
  await waitForBoard(page);

  const renamedAfterReload = await columnByTitle(page, "Complete");
  await expect(renamedAfterReload.getByLabel("Column title")).toHaveValue("Complete");

  // Rename back so later runs against the same dev database (outside CI's
  // fresh-db e2e run) still find the original seeded title.
  const revertInput = renamedAfterReload.getByLabel("Column title");
  await revertInput.fill("Done");
  await revertInput.blur();
});

test("moves a card between columns and it survives a reload", async ({ page }) => {
  const discovery = await columnByTitle(page, "Discovery");
  const review = await columnByTitle(page, "Review");
  const card = discovery.getByTestId(/^card-/).first();
  const cardText = await card.locator("h4").innerText();

  const cardBox = await card.boundingBox();
  const columnBox = await review.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  // Target a point near the column's top, not its vertical center: other
  // tests in this file grow other columns (e.g. Backlog), and CSS grid's
  // default row-stretch makes every column in the row match the tallest
  // one's height - a center-based target can end up below the viewport.
  const dropX = columnBox.x + columnBox.width / 2;
  const dropY = columnBox.y + 40;

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2, {
    steps: 5,
  });
  await page.mouse.move(dropX, dropY, { steps: 20 });
  await page.mouse.up();
  await expect(review.getByText(cardText)).toBeVisible();

  await page.reload();
  await waitForBoard(page);

  const reviewAfterReload = await columnByTitle(page, "Review");
  const discoveryAfterReload = await columnByTitle(page, "Discovery");
  await expect(reviewAfterReload.getByText(cardText)).toBeVisible();
  await expect(discoveryAfterReload.getByText(cardText)).not.toBeVisible();
});

test("deletes a card and it survives a reload", async ({ page }) => {
  const review = await columnByTitle(page, "Review");
  await review.getByRole("button", { name: /add a card/i }).click();
  await review.getByPlaceholder("Card title").fill("Temporary card");
  await review.getByRole("button", { name: /add card/i }).click();
  await expect(review.getByText("Temporary card")).toBeVisible();

  await review.locator('button[aria-label="Delete Temporary card"]').click();
  await expect(review.getByText("Temporary card")).not.toBeVisible();

  await page.reload();
  await waitForBoard(page);

  const reviewAfterReload = await columnByTitle(page, "Review");
  await expect(reviewAfterReload.getByText("Temporary card")).not.toBeVisible();
});
