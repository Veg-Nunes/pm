import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  cardByTitle,
  cardTitlesIn,
  columnByTitle,
  dragCardTo,
  login,
  scrollToTop,
  waitForBoard,
} from "./helpers";

// Regression coverage for a real bug report: cards would intermittently
// land in the wrong lane, or snap back to their start, when dragged.
// Root cause was dnd-kit's default `closestCorners` collision detection
// comparing every card's rect globally instead of scoping to the lane
// actually under the pointer - see the "collisionDetectionStrategy" comment
// in KanbanBoard.tsx. These tests use cards created just for this test (so
// assertions aren't sensitive to the exact seeded card count) and check the
// *exact* resulting card order in each affected lane after every move, not
// just "the card is somewhere in the right lane."

// A real drag near the viewport edge triggers dnd-kit's built-in
// auto-scroll; a synthetic `page.mouse.move` sequence doesn't get that for
// free, and a Kanban column here easily grows taller than the 720px
// default viewport once a couple of temp cards are added. Rather than
// fight scrolling mid-drag, use a viewport tall enough that every card
// these tests touch stays on-screen throughout.
test.use({ viewport: { width: 1280, height: 1600 } });

const PREFIX = "DnD E2E";

const addCard = async (column: Locator, title: string) => {
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByRole("button", { name: /^add card$/i }).click();
  await expect(column.getByText(title)).toBeVisible();
};

const deleteCardIfPresent = async (page: Page, title: string) => {
  const button = page.locator(`button[aria-label="Delete ${title}"]`);
  if ((await button.count()) > 0) {
    await button.first().click();
    await expect(page.getByText(title)).not.toBeVisible();
  }
};

test.beforeEach(async ({ page }) => {
  await login(page);
});

test.afterEach(async ({ page }) => {
  // Best-effort cleanup in case an assertion above failed mid-test, so a
  // failed local run doesn't leave junk cards for the next one.
  for (const suffix of ["A", "B", "C", "D"]) {
    await deleteCardIfPresent(page, `${PREFIX} ${suffix}`);
  }
});

test("drag-and-drop lands cards in the exact lane and position requested, across several moves", async ({
  page,
}) => {
  const backlog = await columnByTitle(page, "Backlog");
  const review = await columnByTitle(page, "Review");
  const inProgress = await columnByTitle(page, "In Progress");

  const backlogSeed = await cardTitlesIn(backlog);
  const reviewSeed = await cardTitlesIn(review);
  const inProgressSeed = await cardTitlesIn(inProgress);

  await addCard(backlog, `${PREFIX} A`);
  await addCard(backlog, `${PREFIX} B`);
  await addCard(review, `${PREFIX} C`);

  // Sanity check on the starting arrangement before any drag happens.
  await expect.poll(() => cardTitlesIn(backlog)).toEqual([
    ...backlogSeed,
    `${PREFIX} A`,
    `${PREFIX} B`,
  ]);

  // 1) Reorder within the same lane: drag A to the end (past B).
  {
    await scrollToTop(page);
    const cardA = cardByTitle(backlog, `${PREFIX} A`);
    const cardB = cardByTitle(backlog, `${PREFIX} B`);
    const bBox = await cardB.boundingBox();
    if (!bBox) throw new Error("card B not visible");
    // Below B's own rect, not just near its inner bottom edge - dropping
    // *on* a card always inserts before it (even near its bottom edge),
    // so landing "after" B requires the point to be outside B's rect,
    // in the column's own droppable area past the last card.
    await dragCardTo(page, cardA, {
      x: bBox.x + bBox.width / 2,
      y: bBox.y + bBox.height + 12,
    });

    await expect.poll(() => cardTitlesIn(backlog)).toEqual([
      ...backlogSeed,
      `${PREFIX} B`,
      `${PREFIX} A`,
    ]);
  }

  // 2) Cross-lane move to the TOP: drag C (Review) to become the first
  // card in Backlog, dropping near the current first card's top edge.
  {
    await scrollToTop(page);
    const cardC = cardByTitle(review, `${PREFIX} C`);
    const firstBacklogCard = backlog.locator('[data-testid^="card-"]').first();
    const firstBox = await firstBacklogCard.boundingBox();
    if (!firstBox) throw new Error("first backlog card not visible");
    await dragCardTo(page, cardC, {
      x: firstBox.x + firstBox.width / 2,
      y: firstBox.y + 6,
    });

    await expect.poll(() => cardTitlesIn(review)).toEqual(reviewSeed);
    await expect.poll(() => cardTitlesIn(backlog)).toEqual([
      `${PREFIX} C`,
      ...backlogSeed,
      `${PREFIX} B`,
      `${PREFIX} A`,
    ]);
  }

  // 3) Cross-lane move to the BOTTOM: drag A (now last in Backlog) into
  // In Progress, dropping below its last existing card (append-to-end).
  {
    await scrollToTop(page);
    const cardA = cardByTitle(backlog, `${PREFIX} A`);
    const lastInProgressCard = inProgress.locator('[data-testid^="card-"]').last();
    const lastBox = await lastInProgressCard.boundingBox();
    if (!lastBox) throw new Error("last in-progress card not visible");
    await dragCardTo(page, cardA, {
      x: lastBox.x + lastBox.width / 2,
      y: lastBox.y + lastBox.height + 12,
    });

    await expect.poll(() => cardTitlesIn(backlog)).toEqual([
      `${PREFIX} C`,
      ...backlogSeed,
      `${PREFIX} B`,
    ]);
    await expect.poll(() => cardTitlesIn(inProgress)).toEqual([
      ...inProgressSeed,
      `${PREFIX} A`,
    ]);
  }

  // 4) Cross-lane move to the MIDDLE: drag B (Backlog) between In
  // Progress's two seeded cards, dropping near the second one's top edge.
  {
    await scrollToTop(page);
    const cardB = cardByTitle(backlog, `${PREFIX} B`);
    const secondInProgressCard = inProgress.locator('[data-testid^="card-"]').nth(1);
    const secondBox = await secondInProgressCard.boundingBox();
    if (!secondBox) throw new Error("second in-progress card not visible");
    await dragCardTo(page, cardB, {
      x: secondBox.x + secondBox.width / 2,
      y: secondBox.y + 6,
    });

    await expect.poll(() => cardTitlesIn(backlog)).toEqual([
      `${PREFIX} C`,
      ...backlogSeed,
    ]);
    await expect.poll(() => cardTitlesIn(inProgress)).toEqual([
      inProgressSeed[0],
      `${PREFIX} B`,
      inProgressSeed[1],
      `${PREFIX} A`,
    ]);
  }

  // Every move above only touched local state optimistically - reload to
  // prove the exact final order (lane + position) was actually persisted
  // to the backend, not just reflected in the UI.
  await page.reload();
  await waitForBoard(page);

  const backlogAfterReload = await columnByTitle(page, "Backlog");
  const inProgressAfterReload = await columnByTitle(page, "In Progress");
  await expect.poll(() => cardTitlesIn(backlogAfterReload)).toEqual([
    `${PREFIX} C`,
    ...backlogSeed,
  ]);
  await expect.poll(() => cardTitlesIn(inProgressAfterReload)).toEqual([
    inProgressSeed[0],
    `${PREFIX} B`,
    inProgressSeed[1],
    `${PREFIX} A`,
  ]);

  // Clean up: delete every temp card so the board returns to its original,
  // seeded arrangement for later tests/runs.
  await deleteCardIfPresent(page, `${PREFIX} A`);
  await deleteCardIfPresent(page, `${PREFIX} B`);
  await deleteCardIfPresent(page, `${PREFIX} C`);

  const backlogFinal = await columnByTitle(page, "Backlog");
  const inProgressFinal = await columnByTitle(page, "In Progress");
  await expect.poll(() => cardTitlesIn(backlogFinal)).toEqual(backlogSeed);
  await expect.poll(() => cardTitlesIn(inProgressFinal)).toEqual(inProgressSeed);
});
