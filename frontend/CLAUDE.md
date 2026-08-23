# Frontend

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4. The
Kanban board is backend-persisted (SQLite via the FastAPI API) and the app
is gated behind real backend-verified login. Built as a static export
(`next.config.ts` sets `output: "export"`) and served by the FastAPI
backend - see [backend/CLAUDE.md](../backend/CLAUDE.md) and the root
`Dockerfile`. `npm run build` produces `frontend/out/`, which the Docker
build copies into `backend/static`.

## Structure

- `src/app/layout.tsx` - root layout, loads Space Grotesk (display) and
  Manrope (body) via the self-hosted `@fontsource-variable/*` packages (not
  `next/font/google` - that fetches from Google Fonts at build time, which
  is unreliable on networks that intercept TLS, including this dev
  machine's; self-hosting removes the network dependency entirely), sets
  page metadata.
- `src/app/page.tsx` - the auth gate. On mount, calls `getSession()`; while
  that's pending renders nothing, then renders `<LoginForm>` if there's no
  session or `<KanbanBoard>` if there is. Passes `login`/`logout` handlers
  down; owns no board state itself.
- `src/lib/auth.ts` - `login`, `logout`, `getSession` - thin wrappers over
  `fetch("/api/login"|"/api/logout"|"/api/me")` with `credentials:
  "include"`.
- `src/components/LoginForm.tsx` - username/password form, calls the
  `onLogin` prop, shows an error message on rejection.
- `src/app/globals.css` - Tailwind import, CSS variables for the color scheme
  (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`,
  `--gray-text`), surface/stroke/shadow tokens.
- `src/lib/kanban.ts` - domain types (`Card`, `Column`, `BoardData`),
  `moveCard` (pure local reorder/transfer logic, used for instant drag
  feedback before the backend confirms). `initialData` is a **test fixture
  only** now - the backend (`backend/db.py#SEED_COLUMNS`) owns seeding a new
  user's board; the app always fetches real data from `GET /api/board`.
- `src/lib/api.ts` - the board API client: `fetchBoard`, `renameColumn`,
  `createCard`, `moveCardRemote`, `deleteCardRemote`. All `fetch` with
  `credentials: "include"`; a 401 response throws `SessionExpiredError`
  (caught by `KanbanBoard` to trigger `onLogout`, since an expired/cleared
  session should look the same to the user as a manual logout).
- `src/components/KanbanBoard.tsx` - the board itself, rendered once a
  session exists. Takes `username`/`onLogout` props (rendered as a "Signed
  in as ..." + "Log out" control in the header). Fetches the board via
  `fetchBoard()` on mount (`board: BoardData | null` - `null` while
  loading); shows a loading message, or a retry button on a failed fetch.
  Every mutation (rename/add/delete/move) applies an optimistic local
  update and fires the matching `lib/api` call; on failure (not a session
  expiry) it shows a dismissible error banner and refetches the board from
  the server to reconcile. Wires up `@dnd-kit/core` `DndContext`
  (PointerSensor, `closestCorners` collision).
- `src/components/KanbanColumn.tsx` - one column: droppable zone
  (`useDroppable`), editable title `<input>` (`onChange` updates local state
  live for responsive typing; `onBlur` is what actually persists via
  `renameColumn` - not every keystroke), `SortableContext` of cards,
  empty-state placeholder, embeds `NewCardForm`.
- `src/components/KanbanCard.tsx` - one draggable card (`useSortable`),
  shows title/details, delete button.
- `src/components/KanbanCardPreview.tsx` - static (non-sortable) card render
  used inside `DragOverlay` while dragging.
- `src/components/NewCardForm.tsx` - inline expand/collapse form to add a
  card (title required, details optional) to a column.

## State model

`BoardData` is `{ columns: Column[], cards: Record<string, Card> }`;
columns reference cards by id via `cardIds` (order matters, defines render
order). `KanbanBoard` fetches this from `GET /api/board` on mount and holds
it in `useState<BoardData | null>`; the backend (SQLite) is the source of
truth, this is a cache reconciled after every mutation.

**Ids must stay prefixed (`col-N` / `card-N`), never bare numbers.**
`board_columns` and `cards` are separate SQL autoincrement sequences in the
backend, both starting at 1 - so column id 3 and card id 3 are two
unrelated rows that happen to share a number. `moveCard()`'s
`findColumnId`/`isColumnId` helpers identify whether a dnd-kit drag/drop id
refers to a column or a card *by the id's shape alone* (no separate type
tag) - with bare ids, a card whose numeric id collides with some column's
id gets misidentified as "dropped onto that column" and the move silently
no-ops. The backend (`backend/board.py`) prefixes every id it returns for
exactly this reason; see `test_column_and_card_ids_are_prefixed` in
`backend/tests/test_board.py` and the Part 7 status note in
`docs/PLAN.md` for the full story. If this ever regresses, dragging a card
whose id happens to collide with a column id will stop working while other
drags keep working - the bug is easy to miss because only some ids clash.

## Testing

- Unit: Vitest + Testing Library (`vitest.config.ts`, `src/test/setup.ts`).
  `src/lib/kanban.test.ts` covers `moveCard` reordering/transfer logic.
  `src/components/KanbanBoard.test.tsx` mocks `@/lib/api`
  (`vi.mock("@/lib/api")`) and covers: loading state, retry-on-fetch-error,
  logout-on-session-expiry, rename-on-blur-not-on-every-keystroke, add/
  delete calling the backend with the right arguments.
  `src/components/LoginForm.test.tsx` covers the form's own behavior.
  `src/app/page.test.tsx` covers the auth-gating logic, with both
  `@/lib/auth` and `@/lib/api` mocked - no real network calls anywhere in
  the unit suite.
  Run: `npm run test:unit` (or `npm run test:unit:watch`).
- E2E: Playwright (`playwright.config.ts`), tests in `tests/*.spec.ts`.
  Since login and the board are now both real (backend-verified /
  backend-persisted, not meaningfully mockable in an e2e test), the
  webServer boots the **full stack**, not `next dev`: it runs `npm run
  build`, copies `out/` into `../backend/static` via
  `scripts/copy-static.mjs`, deletes `../backend/data` via
  `scripts/reset-db.mjs` (so every e2e run starts from the known seed, not
  whatever's left over from a previous run or manual testing), then starts
  the backend itself (`uv run --project ../backend uvicorn backend.main:app
  --port 8000`). Tests hit `http://127.0.0.1:8000` - same origin serving
  both the UI and the API, exactly like Docker. Requires `uv` on `PATH`,
  and nothing else already bound to port 8000 (e.g. stop the Docker
  container first).
  - `tests/helpers.ts` - `login(page)`; `waitForBoard(page)` (wait for the
    "Kanban Studio" heading - needed after every `page.reload()`, since the
    board reloads asynchronously and querying columns immediately after
    `reload()` races the fetch); `columnByTitle(page, title)` (columns have
    backend-assigned numeric ids now, not stable names, so tests locate them
    by their current title, read live via `inputValue()` - a CSS `[value=]`
    selector would only see the initial DOM attribute, not React state
    updates); `expectColumnTitles`.
  - `tests/auth.spec.ts` - login form shown when signed out, wrong password
    rejected, full login -> board -> logout -> reload-stays-logged-out flow.
  - `tests/kanban.spec.ts` - one test per mutation (add/rename/move/delete),
    each reloading the page afterward and asserting the change survived -
    this is what actually proves persistence, not just that the UI updated
    optimistically. Tests share one backend DB across the file (no
    per-test reset), so the rename test reverts its change and the delete
    test creates-then-deletes its own card, keeping later tests unaffected.
    The drag test targets a point near the top of the destination column,
    not its vertical center - CSS grid's default row-stretch makes every
    column in a row match the tallest one's height, so a center-based
    target can land below the viewport once an earlier test has grown
    another column.
  Run: `npm run test:e2e`. Combined: `npm run test:all`.

## Conventions

- Components are named-exported arrow function components (`export const
  Foo = () => ...`), not default exports (except `page.tsx`/`layout.tsx`,
  which Next.js requires as default exports).
- Styling is Tailwind utility classes referencing the CSS variables above via
  `[var(--token)]`, plus `clsx` for conditional classes. No component-level
  CSS files.
- `"use client"` is only on `KanbanBoard.tsx` (the stateful root); leaf
  components inherit client context from their parent tree.

## Known gaps for later plan parts

- No AI chat sidebar (Part 8-10).
