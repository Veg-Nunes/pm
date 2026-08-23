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

export const expectColumnTitles = async (page: Page, titles: string[]) => {
  const values = await page
    .locator('[data-testid^="column-"] input[aria-label="Column title"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(values).toEqual(titles);
};
