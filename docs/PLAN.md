# Project Plan

High-level parts, each broken into a checklist with tests and success
criteria. Work proceeds part by part; do not start a part until the previous
one's success criteria are met. See root [CLAUDE.md](../CLAUDE.md) for
business requirements, tech decisions, and coding standards.

---

## Part 1: Plan

- [x] Review root `CLAUDE.md` and this document.
- [x] Enrich this document with per-part checklists, tests, and success
      criteria.
- [x] Write `frontend/CLAUDE.md` describing the existing frontend code.
- [ ] User reviews and approves this plan before Part 2 starts.

**Success criteria:** user has explicitly signed off on this plan.

---

## Part 2: Scaffolding

Set up Docker, the FastAPI backend skeleton, and start/stop scripts. Prove
the container runs, serves a static "hello world" page, and the page can
call a backend API route.

- [x] Create `backend/` FastAPI app (`uv` project: `pyproject.toml`, `uv.lock`).
  - [x] `GET /api/health` route returning `{"status": "ok"}`.
  - [x] `GET /` serves a placeholder static HTML file (not yet the Next
        build - that's Part 3) confirming FastAPI can serve static content.
- [x] Write `backend/CLAUDE.md` describing the backend structure (replace
      the current placeholder).
- [x] Write a single `Dockerfile` at the project root:
  - [x] Build stage installs deps via `uv`, runs the FastAPI app with
        `uvicorn`. (Single-stage for now; Part 3 adds a frontend build
        stage.)
  - [x] Loads `OPENROUTER_API_KEY` from environment (passed via `.env` at
        run time, not baked into the image).
  - [x] Exposes the app port (8000).
- [x] Write `scripts/start.sh` (Mac/Linux), `scripts/start.ps1` (Windows),
      and matching `stop.*` scripts that build/run/stop the Docker
      container, reading `.env` for secrets.
- [x] Update `scripts/CLAUDE.md` describing what each script does.

**Tests / verification:**
- `docker build` succeeds.
- Running the start script brings up the container; `curl
  http://localhost:8000/` returns the placeholder HTML; `curl
  http://localhost:8000/api/health` returns `{"status": "ok"}`.
- The stop script cleanly stops/removes the container.

**Success criteria:** a fresh clone can run the start script, hit `/` and
`/api/health` successfully over HTTP, and the stop script shuts it down
cleanly, on Mac, Linux, and Windows.

**Status: done.** Verified `docker build` succeeds, `scripts/start.sh` and
`scripts/start.ps1` both build and run the container with `/api/health`
returning `{"status":"ok"}` and `/` returning the placeholder page (200),
and `scripts/stop.sh` / `scripts/stop.ps1` both remove the container
cleanly. Backend unit tests (`uv run --project backend pytest`) pass.
Not verified on native Mac/Linux (only Windows + Docker Desktop's Linux
containers), but the scripts and Dockerfile use no Windows-specific
tooling.

---

## Part 3: Add in Frontend

Serve the real Next.js app (statically built) from FastAPI at `/`, replacing
the Part 2 placeholder.

- [x] Configure Next.js for static export (`output: "export"` in
      `next.config.ts`), confirm `npm run build` produces a static `out/`
      (or equivalent) directory.
- [x] Update the Dockerfile build stage to run `npm ci && npm run build` for
      `frontend/` and copy the static output into the backend's static
      directory.
- [x] Update FastAPI to serve the built frontend (`StaticFiles`) at `/`,
      with client-side routing fallback if needed. (Single-page app with no
      client routes, so no fallback logic was needed beyond `html=True`.)
- [x] Confirm the demo Kanban board (from the existing frontend code, see
      `frontend/CLAUDE.md`) renders correctly when served this way, styling
      and fonts included.

**Tests / verification:**
- Frontend unit tests (`npm run test:unit`) and e2e tests (`npm run
  test:e2e`) still pass against the dev server.
- New integration check: after `docker build` + start script, hitting `/`
  in a browser (or via an e2e test pointed at the container's port) shows
  the Kanban board with 5 columns and the seed cards, matching the
  standalone dev-server behavior.
- Backend unit test asserting `/` returns the built `index.html` (status
  200, contains expected marker e.g. `<title>Kanban Studio`).

**Success criteria:** `docker build` + start script serves the full working
Kanban demo UI at `/`, indistinguishable in behavior from `npm run dev`,
verified by both frontend and backend automated tests.

**Status: done.** `next.config.ts` sets `output: "export"`. Dockerfile now
multi-stage: a `node:24-slim` stage runs `npm ci && npm run build` and its
`out/` is copied into the runtime stage's `backend/static`. Frontend unit
tests (6/6) and e2e tests (3/3) pass against the dev server. Backend pytest
suite (2/2) passes, serving whatever is in `backend/static` at the time
(placeholder locally, real build inside Docker - see note below). Manually
verified end-to-end with a real browser (Playwright) against the running
container: heading, all 5 columns, and seed cards render with correct
fonts/styling, drag-and-drop between columns works, and adding a card
works, with zero console errors.

Note: `backend/static/` holds a hand-written placeholder outside Docker
(kept from Part 2, so `uv run uvicorn` works standalone without a frontend
build) and is only replaced with the real Next.js export inside the Docker
image - it's not synced automatically for local non-Docker backend dev.

---

## Part 4: Add in a Fake User Sign-In Experience

Gate the Kanban view behind a login screen using hardcoded credentials
(`user` / `password`), with logout.

- [x] Backend: `POST /api/login` validating hardcoded `user`/`password`,
      issuing a session (cookie-based, e.g. signed session cookie - keep it
      simple, no real auth library needed for MVP).
- [x] Backend: `POST /api/logout` clearing the session.
- [x] Backend: session-check dependency/middleware protecting the Kanban
      API routes added in later parts (for now, can be a placeholder
      protected route). (`require_session` dependency, used by `GET
      /api/me`.)
- [x] Frontend: login page/form (username + password fields, error message
      on bad credentials).
- [x] Frontend: redirect unauthenticated users hitting `/` to the login
      screen; redirect authenticated users away from the login screen.
      (Single route, no client-side routing needed - `page.tsx` conditionally
      renders `LoginForm` vs `KanbanBoard` based on session state.)
- [x] Frontend: logout control visible once signed in.

**Tests / verification:**
- Backend unit tests: correct creds succeed and set a session; wrong creds
  return 401; protected route rejects when no/invalid session; logout
  clears the session so the protected route then rejects.
- Frontend unit tests: login form validation/error display; redirect
  behavior when unauthenticated.
- E2E test: visiting `/` without a session shows login; logging in with
  `user`/`password` shows the Kanban board; logging out returns to login
  and re-visiting `/` no longer shows the board.

**Success criteria:** the app cannot be used without logging in with the
hardcoded credentials, logout works, and this is covered end-to-end by an
automated test, not just manual verification.

**Status: done.** Backend: `SessionMiddleware` (signed cookie via
`itsdangerous`, key `SESSION_SECRET_KEY` in `.env`) plus `/api/login`,
`/api/logout`, `/api/me`. 6/6 backend pytest cases pass (wrong creds,
correct creds + session persists, logout clears session, `/api/me`
unauthorized without a session). Frontend: `page.tsx` gates on session
state, `LoginForm` + `src/lib/auth.ts` added; 12/12 Vitest unit tests pass
(login form validation/error, page-level auth-gating with mocked
`src/lib/auth`). E2E: since auth needs a real backend, Playwright's
webServer now runs the actual built app (frontend build + FastAPI, same as
Docker) instead of `next dev` - see `frontend/CLAUDE.md`; 6/6 e2e tests
pass, including the full login -> board -> logout -> reload-stays-logged-out
flow. Also manually verified in a real browser against the Docker
container (screenshots), including the wrong-password error path.

Side fix: `next/font/google` (Manrope, Space Grotesk) was fetching from
Google Fonts at build time, which failed intermittently on this dev
machine's network (and, transiently, inside the Docker build too) - root
cause was the network dependency itself, not a TLS flag to chase. Fixed by
switching to self-hosted `@fontsource-variable/manrope` /
`@fontsource-variable/space-grotesk` (no network access needed at build
time at all). Unrelated to auth but discovered while rebuilding for this
part.

---

## Part 5: Database Modeling

Design the persistence schema before writing backend routes.

- [x] Propose a schema supporting: multiple users (even though MVP only
      logs in one), one board per user, columns (ordered, renameable),
      cards (title, details, ordered within a column).
- [x] Save the schema as JSON (e.g. `docs/schema.json` - table/column
      definitions, types, keys, relationships).
- [x] Write `docs/database.md` explaining the approach: why SQLite, table
      structure, how ordering is stored (e.g. explicit position column vs.
      linked list), how the hardcoded user maps to a `users` row.
- [x] Get user sign-off before Part 6 starts.

**Tests / verification:** none (design artifact only) - reviewed by the
user.

**Success criteria:** user has explicitly approved the schema in
`docs/schema.json` and `docs/database.md`.

**Status: done, approved by user.** Four tables: `users`, `boards`
(`UNIQUE(user_id)` enforces one board per user), `board_columns`, `cards`.
Ordering via an explicit `position` column (not a linked list) on both
`board_columns` and `cards`. See `docs/database.md` for full rationale.

---

## Part 6: Backend

Implement the Kanban CRUD API against the approved schema.

- [x] SQLite DB created automatically on first run if it doesn't exist
      (schema migration/init on startup).
- [x] Routes (all behind the Part 4 session check), e.g.:
  - [x] `GET /api/board` - full board (columns + cards) for the logged-in
        user.
  - [x] `PATCH /api/columns/{id}` - rename a column.
  - [x] `POST /api/cards` - create a card in a column.
  - [x] `PATCH /api/cards/{id}` - edit a card (title/details) and/or move
        it (column + position).
  - [x] `DELETE /api/cards/{id}` - delete a card.
- [x] Seed a default board (matching the current frontend demo columns) for
      a user on first access if they have none.

**Tests / verification:**
- Backend unit tests per route: happy path, not-found cases, unauthenticated
  rejection, DB actually persists changes (re-fetch reflects prior writes).
- Test that a fresh (deleted) DB file is recreated with the expected schema
  on startup.

**Success criteria:** full CRUD + move on columns/cards works via the API
against a real SQLite file, covered by backend unit tests, with DB
auto-creation verified.

**Status: done.** `backend/db.py` (schema + seed + move logic),
`backend/board.py` (routes), `backend/auth.py` (auth split out of
`main.py` to avoid a circular import with `board.py`). 23/23 backend pytest
cases pass, including: full route coverage (happy path, 404s, 401s without
a session), a re-fetch-after-write check on every mutation, and a test that
deletes the SQLite file mid-test and confirms `GET /api/board` transparently
recreates it. Manually verified against a real running instance (`uv run
uvicorn`) and against the Docker container via `curl`: login, create card,
move card cross-column all persisted correctly on re-fetch.

Bug found and fixed during manual verification, beyond this part's stated
scope: `scripts/start.*` always does `docker rm -f` + a fresh `docker run`
(needed so a rebuild picks up code changes), which - with no volume mount -
was silently wiping the SQLite file on every restart. This is what the user
was actually hitting when they reported "new tiles are not saved" (filed
before Part 6 existed, when the board was still pure frontend state, but
the restart-wipes-data behavior would have resurfaced immediately once Part
6 landed). Fixed by mounting `./backend/data` into the container in both
`start.sh` and `start.ps1`, and excluding `backend/data` via
`.dockerignore` so a stale local DB is never baked into the image. Verified
by creating a card, restarting via `scripts/stop.ps1` + `scripts/start.ps1`
(full container recreation, not just a process restart), and confirming
the card was still there after.

---

## Part 7: Frontend + Backend

Replace the frontend's local `useState` board data with real API calls, so
the board persists across reloads.

- [x] Frontend: fetch the board from `GET /api/board` on load instead of
      using `initialData` directly (initial data becomes a backend seed
      concern only, per Part 6).
- [x] Frontend: rename/add/delete/move handlers call the corresponding
      backend routes; reconcile local state with the server response (or
      refetch).
- [x] Handle loading and error states (e.g. API unreachable, session
      expired -> redirect to login).

**Tests / verification:**
- Frontend unit tests: components call the expected API functions with
  correct payloads; loading/error states render correctly (mocked fetch).
- E2E tests (against the real backend, real SQLite): add a card, reload the
  page, card persists; rename a column, reload, rename persists; move a
  card, reload, position persists; delete a card, reload, it's gone.

**Success criteria:** the Kanban board is fully persistent through page
reloads and container restarts, verified by e2e tests that reload the page
between actions and assertions.

**Status: done.** `KanbanBoard` fetches via `fetchBoard()` on mount
(loading state, retry-on-error state), and every mutation calls the
matching `src/lib/api.ts` function with an optimistic local update;
`SessionExpiredError` (401) triggers `onLogout`; other failures show an
error banner and refetch to reconcile. Rename persists on blur, not per
keystroke. 14/14 frontend unit tests pass (mocked `@/lib/api`). 8/8 e2e
tests pass, including one per mutation that reloads the page and asserts
the change survived. Also manually verified twice against the real Docker
container with a browser agent: add/reload, drag-move/reload, rename/
reload (both directions), delete/reload, and logout/login all correctly
persist or reset as expected, zero console errors.

**Bug found during e2e testing, not by inspection - a real regression this
part introduced:** dragging a card between columns silently did nothing
for *some* cards. Root cause: `board_columns.id` and `cards.id` are
separate SQLite autoincrement sequences, both starting at 1, so a card and
a column can end up with the same numeric id (e.g. column 3 = "In
Progress", card 3 = "Prototype analytics view" - confirmed via browser
console + a direct `/api/board` fetch mid-test, not guessed). The
frontend's `moveCard()` (`frontend/src/lib/kanban.ts`, unchanged and still
correct - covered by its own passing unit tests, which use prefixed
fixture ids) identifies whether a dnd-kit drag id refers to a column or a
card by the id's shape alone; Part 6's API returned bare integers, so a
colliding card id got misread as a column id and the move no-op'd. Fixed
by having the API return prefixed ids (`"col-3"`, `"card-6"`) instead of
bare integers - `backend/board.py`'s `_column_id`/`_card_id` parse the
prefix off internally, `_column_out`/`_card_out` add it back on. Added
`test_column_and_card_ids_are_prefixed` as a regression guard, and a note
in both `frontend/CLAUDE.md` and `backend/CLAUDE.md` explaining why the
prefix must never be dropped. Caught by the e2e drag-and-drop test itself
(the card visibly snapped back to its original column instead of moving -
`moveCard()`'s misidentification path returns the input unchanged rather
than erroring, so nothing threw, it just silently did nothing) - a good
argument for real drag simulation in e2e tests rather than only unit
tests that call `moveCard()` directly with hand-picked, always-prefixed
fixture ids.

---

## Part 8: AI Connectivity

Prove the backend can call an LLM via OpenRouter.

- [x] Backend: OpenRouter client using `OPENROUTER_API_KEY` from `.env`.
- [x] `POST /api/ai/ping` (or similar dev-only route) that sends a trivial
      prompt (e.g. "What is 2+2? Answer with only the number.") and returns
      the model's answer.
- [x] Choose and document the specific OpenRouter model used.

**Tests / verification:**
- Backend test (may be marked as requiring network/API key, skipped in CI
  without a key) that calls the route and asserts the response contains
  "4".

**Success criteria:** a real OpenRouter call succeeds end-to-end and
returns the expected answer, run manually and documented as tested.

**Status: done.** `backend/ai.py` adds `call_openrouter()` (posts to
OpenRouter's OpenAI-compatible `/chat/completions` endpoint) and `POST
/api/ai/ping`, behind `require_session` like every other route. Model
chosen: `openai/gpt-4o-mini` - cheap and fast, and it supports OpenRouter's
Structured Outputs feature that Part 9's board-aware chat endpoint needs.
2/2 new backend tests pass: `test_ping_requires_session` (always runs) and
`test_ping_asks_openrouter_and_gets_four` (a real network call, `skipif`'d
on a missing `OPENROUTER_API_KEY`). Full suite is 26/26. Manually verified
twice: via `uv run uvicorn` locally, and via `curl` against the real
Docker container after logging in - both returned `{"answer":"4"}`.

Bug found and fixed, same class as the Part 4 fonts issue: the real
OpenRouter call initially failed locally with `SSL: CERTIFICATE_VERIFY_FAILED`
- this dev machine's network TLS-intercepts outbound HTTPS, and `httpx`'s
default `certifi` CA bundle doesn't trust the intercepting proxy's
certificate. Unlike the Google Fonts case, this network dependency is the
entire point of Part 8 and can't be designed away. Root-caused (not
guessed) as the same underlying issue that made `uv add`/`uv sync` need
`--system-certs` earlier in the project; fixed the same way, using the
`truststore` package to point `httpx`'s SSL context at the OS trust store
instead of `certifi`'s bundled one (`truststore.inject_into_ssl()` in
`backend/ai.py`). This was not needed inside the Docker container - the
real `curl` test against it succeeded without it, so the interception is
specific to this host's own network path, not something the shipped app
needs to work around in general.

---

## Part 9: AI Kanban-Aware Chat Endpoint

Extend the AI call to be board-aware and return structured output.

- [x] Backend: `POST /api/ai/chat` accepting `{ message, history }`.
- [x] Request to OpenRouter includes: the current board JSON, the
      conversation history, and the user's new message.
- [x] Use OpenRouter Structured Outputs (JSON schema) so the response is
      `{ reply: string, boardUpdate?: <board patch/full board> }`.
- [x] On a returned `boardUpdate`, apply it to the database (reusing Part 6
      persistence logic).
- [x] Decide and document the shape of `boardUpdate` (full board replace vs.
      targeted patch operations) in `docs/database.md` or a new doc.

**Tests / verification:**
- Backend unit tests with a mocked OpenRouter response: reply-only response
  leaves the board unchanged; response with a `boardUpdate` persists the
  change and is reflected in `GET /api/board`.
- Manual/integration test (real API key) for at least one realistic prompt,
  e.g. "add a card called X to Backlog" -> card appears in the DB.

**Success criteria:** the chat endpoint reliably returns structured JSON,
board updates from the AI are correctly persisted, and non-update chats
leave the board untouched - covered by mocked unit tests plus one verified
real-API run.

**Status: done.** `POST /api/ai/chat` (`backend/ai.py`) sends a system
prompt plus the live board JSON plus conversation history to OpenRouter,
constrained to a strict JSON schema (`CHAT_JSON_SCHEMA`) that returns
`{reply, operations}` - `operations` being the model's instruction list
(create/edit/move a card), separate from `boardUpdate`, which is the API
response's full post-change board snapshot (chose full board over a patch
- see `docs/ai-chat.md` for the reasoning). Applying operations reuses
`db.py`'s `create_card`/`update_card_fields`/`move_card` - the same
functions `board.py`'s human-driven routes call, extracted from `board.py`
into `db.py` in this part specifically so the AI path and the UI path share
one persistence implementation instead of two. 9 new backend tests (6
mocked - reply-only leaves the board untouched, create/move operations
persist and appear in a re-fetch, a hallucinated id is silently skipped
rather than erroring; 2 real-API, `skipif`'d without a key: one for Part
8's ping, one that asks the real model to add a specific card and asserts
it exists afterward). Full suite: 32/32. Also manually verified three real
conversational turns against the running Docker container: adding a named
card (persisted, `boardUpdate` returned), a pure question (board
unchanged, `boardUpdate: null`), and an out-of-scope request ("rename a
column") correctly refused in the reply rather than attempted.

Bug found while writing the real-API test, not by inspection: the first
version of the system prompt ("You can create cards, edit... and move...
- nothing else (you cannot rename columns or add/remove columns)")
sometimes made `gpt-4o-mini` respond "I can't create new cards" and return
empty `operations` - it read "add/remove columns" as adjacent to "add
cards" and got the capability backwards. Confirmed via a scratch script
that printed the raw OpenRouter completion (not guessed) before rewriting
the prompt as an explicit bulleted list of the three actions with an
instruction to actually add the operation rather than only describing it
in words - verified reliable across several repeated real calls afterward.
A reminder that a structured-output schema alone doesn't guarantee the
model exercises the capability you gave it; the prompt's wording matters
just as much and needs the same "verify with a real call, don't guess"
treatment as code.

---

## Part 10: AI Chat Sidebar UI

Add the chat UI and wire it to auto-refresh the board on AI-driven updates.

- [x] Frontend: sidebar component with message list, input box, send
      button, loading indicator while awaiting a response.
- [x] Sends `{ message, history }` to `POST /api/ai/chat`, appends the
      reply to the chat history.
- [x] If the response includes a board update, refetch/update the board
      state so the Kanban view reflects it immediately without a manual
      page reload.
- [x] Styling matches the existing color scheme and overall visual language
      of the app.

**Tests / verification:**
- Frontend unit tests: sending a message calls the API with the right
  payload; a response with no board update only updates the chat; a
  response with a board update triggers a board refresh (mocked).
- E2E test (real backend, real OpenRouter call or a test double if
  configured): ask the AI to add a specific card via chat, assert it
  appears on the board in the UI without a manual reload.

**Success criteria:** a user can drive Kanban changes entirely through the
chat sidebar and see the board update live, covered end-to-end by an
automated test.

**Status: done.** `frontend/src/components/ChatSidebar.tsx` - message list,
input, Send button, "Thinking..." loading indicator, rendered by
`KanbanBoard`. Calls `sendChatMessage(message, history)`
(`frontend/src/lib/api.ts`); the response's `boardUpdate` (when present) is
passed straight to `KanbanBoard`'s `setBoard` - no refetch needed, since
Part 9's `boardUpdate` is already the full current board in the same shape
`fetchBoard()` returns. Session expiry during a chat call triggers logout,
same as every other mutation. 6 new frontend unit tests (mocked `@/lib/api`)
plus 2 new e2e tests making real OpenRouter calls (skipped without
`OPENROUTER_API_KEY`, matching Part 8/9's backend test pattern): adding a
card via chat appears on the board with no reload, and a non-board-changing
question leaves the board untouched. Full suites: 20/20 frontend unit,
32/32 backend, 10/10 e2e (run twice, stable). Also manually verified via a
real browser against the running Docker container: login, board + sidebar
render with consistent styling, a chat-driven card creation appears live,
a follow-up question doesn't change the board, zero console errors during
either exchange.

Two bugs found while testing, not by inspection:

1. **Layout regression from adding the sidebar.** Squeezing a fixed-340px
   sidebar next to the existing 5-column board (at `lg`, 1024px+) left the
   board too narrow at common widths, including Playwright's 1280px
   default test viewport - card `details` text wrapped onto many lines,
   pushing card height past the viewport's fold. The drag-and-drop e2e test
   (passing since Part 7) started failing consistently: `page.mouse.move`/
   `down` don't auto-scroll like locator actions do, so the computed drop
   coordinates landed off-screen, the mousedown missed the card entirely,
   and the browser performed a native text-selection drag instead of a
   dnd-kit one - the card silently never moved. Root-caused (not guessed)
   via a temporary debug spec that logged real bounding boxes and captured
   screenshots mid-drag, which showed browser text-selection highlighting
   instead of a drag ghost. Fixed by moving the side-by-side breakpoint from
   `lg` to `2xl` (1536px) - below that, the assistant panel stacks full-width
   below the board instead, keeping the board at its original width. See
   the "Layout: chat sidebar breakpoint" note in `frontend/CLAUDE.md`.
2. **Cross-file e2e test interference.** With the new `ai-chat.spec.ts`
   also mutating the Backlog column, it started racing `kanban.spec.ts`'s
   own Backlog mutations under Playwright's default multi-worker
   parallelism - both spec files share one backend DB with no per-file
   reset. Fixed by setting `workers: 1` in `playwright.config.ts`, matching
   the shared-DB assumption the existing suite already depended on.

---

## Post-Part-10 fix: unreliable drag-and-drop

User report after Part 10 shipped: dragging cards between lanes was
inconsistent in real use - sometimes a card snapped back to its start,
sometimes it jumped to the wrong lane, sometimes it landed correctly.

**Root cause:** `KanbanBoard` used dnd-kit's default `closestCorners`
collision detection, which compares every droppable rect *globally* -
every column **and every card in every column** - with no notion of "this
card is nested inside that column." A card's corner in an adjacent column
could end up geometrically closer than whatever was actually under the
pointer, so the resolved drop target was effectively unpredictable near
column/card boundaries. This explains all three symptoms: "wrong lane"
(collision resolved to a card in a different column), "snapped back"
(resolved `over` id equaled the active card's own id, which `handleDragEnd`
correctly treats as a no-op), and "worked sometimes" (when the pointer
was unambiguously closest to the intended target, `closestCorners` still
got it right by chance).

**Fix:** replaced it with a custom two-phase `collisionDetectionStrategy`
in `KanbanBoard.tsx` - the pattern dnd-kit itself documents for
multi-container sortable boards: `pointerWithin` (falling back to
`rectIntersection`) first finds which *column* the pointer is over, then
`closestCenter` - scoped to *only that column's own cards* - finds the
nearest card within it. A drop past the last card's own rect (not merely
near its bottom edge, but genuinely below it) is treated as "append to the
end of this column" rather than "insert before the nearest card," since
without that explicit check there's no way to target the very end of a
non-empty column. Full design rationale in `frontend/CLAUDE.md`'s
"Drag-and-drop collision detection" section.

**Tests / verification:** New `frontend/tests/drag-and-drop.spec.ts` -
creates temp cards so assertions aren't tied to the seeded card count, then
performs four move types in sequence, checking the *exact* resulting card
order (not just "the card is in the right lane") after each: reorder
within a lane, cross-lane move to the top of a lane, cross-lane move to
the bottom (append), and cross-lane move to a specific middle position.
Reloads at the end to confirm the final arrangement persisted, then cleans
up. Passed 3/3 consecutive runs. Full e2e suite: 11/11, run twice, stable.
Frontend unit (20/20) and lint unaffected. Also manually verified with a
real browser (genuine multi-step mouse gestures, not a single teleport)
against the running Docker container: 5 distinct drags (same-lane reorder,
cross-lane to top/middle/bottom, and one more cross-lane move), every one
landing in the exact intended lane and position, confirmed again after a
page reload, zero drag-related console errors.

Writing the test itself surfaced two unrelated test-authoring gotchas
(not app bugs, but worth recording so they don't get mistaken for one
again): dropping "on" a card - even near its bottom edge - always means
"insert before this card," so testing "insert after" requires a drop point
past that card's rect entirely; and a Kanban column easily grows taller
than the default 720px e2e viewport once a couple of cards are added, and
raw `page.mouse.move`/`down`/`up` don't get dnd-kit's built-in auto-scroll
the way a real user's drag does, so `drag-and-drop.spec.ts` uses a taller
1280x1600 viewport rather than fighting mid-drag scrolling.
