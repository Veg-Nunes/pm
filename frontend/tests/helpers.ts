import { expect, type Locator, type Page } from "@playwright/test";

export const waitForBoard = (page: Page) =>
  page.getByRole("heading", { name: "Kanban Studio" }).waitFor();

export const login = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await waitForBoard(page);
};

// Column/card ids are backend-assigned (numeric), not the old hardcoded
// "col-backlog" style ids, so tests locate columns by their current title
// (read live via inputValue - the title `<input>`'s DOM attribute doesn't
// reflect React state updates, only its property, so a CSS `[value=]`
// selector can't be used here).
export const columnByTitle = async (page: Page, title: string): Promise<Locator> => {
  const columns = page.locator('[data-testid^="column-"]');
  const count = await columns.count();
  for (let index = 0; index < count; index += 1) {
    const column = columns.nth(index);
    if ((await column.getByLabel("Column title").inputValue()) === title) {
      return column;
    }
  }
  throw new Error(`No column found with title "${title}"`);
};

// Locator actions (like `.click()`) auto-scroll their target into view,
// which can leave the page scrolled away from where it was when an earlier
// boundingBox() was captured - a later raw `page.mouse.move` computed from
// that stale box then misses entirely (observed as a coordinate with a
// negative y, off-screen above the viewport). Call this right before
// computing box coordinates for a drag so both the source and target boxes
// are measured from the same, known (unscrolled) frame of reference.
export const scrollToTop = (page: Page) =>
  page.evaluate(() => window.scrollTo(0, 0));

// Drags `card` to a specific point via raw mouse events (not a locator
// action, so it doesn't auto-scroll - see the note in kanban.spec.ts about
// keeping drop targets within the viewport). Moves in two steps like a real
// drag: a small nudge past the PointerSensor's activation distance first,
// then the full move to the target, both with intermediate steps so
// dnd-kit's collision detection sees the drag as in-progress rather than a
// single teleport.
export const dragCardTo = async (
  page: Page,
  card: Locator,
  target: { x: number; y: number }
) => {
  const cardBox = await card.boundingBox();
  if (!cardBox) {
    throw new Error("Card is not visible - cannot compute drag start point.");
  }
  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 20 });
  await page.mouse.up();
};

export const cardByTitle = (column: Locator, title: string) =>
  column.locator('[data-testid^="card-"]').filter({ hasText: title });

export const cardTitlesIn = (column: Locator) =>
  column.locator('[data-testid^="card-"] h4').allTextContents();

export const expectColumnTitles = async (page: Page, titles: string[]) => {
  const values = await page
    .locator('[data-testid^="column-"] input[aria-label="Column title"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).toEqual(titles);
};
