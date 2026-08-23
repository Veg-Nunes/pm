# Backend

FastAPI app, managed with `uv`. Serves a health check, hardcoded-credential
session auth, the Kanban board CRUD API (backed by SQLite), and the built
frontend as static files. AI routes are added in later parts.

## Structure

- `pyproject.toml` / `uv.lock` - `uv` project (`src` layout, package name
  `backend`).
- `src/backend/main.py` - creates the `FastAPI` app, adds
  `SessionMiddleware`, registers `GET /api/health`, includes the `auth` and
  `board` routers, then mounts `StaticFiles(html=True)` at `/` last (so
  `/api/*` is matched before falling through to static file serving).
- `src/backend/auth.py` - login/session. `POST /api/login` (body
  `{username, password}`; only hardcoded `user`/`password` succeeds, per
  root `CLAUDE.md`), `POST /api/logout`, `GET /api/me`, and the
  `require_session` dependency other routers depend on. Sessions are
  Starlette's `SessionMiddleware` (signed client-side cookie via
  `itsdangerous`, no server-side session store); signing key is
  `SESSION_SECRET_KEY` from the root `.env`.
- `src/backend/db.py` - SQLite data layer per `docs/schema.json`:
  `init_db` (`CREATE TABLE IF NOT EXISTS` x4, run on every `get_connection`
  call - so a deleted DB file is transparently recreated), `ensure_board`
  (creates the `users`/`boards` rows for a username on first access,
  seeding columns/cards to match the frontend's original demo data if the
  user has no board yet), and `move_card`/`set_column_cards` (card
  reordering - see below). DB file at `data/kanban.db` (gitignored,
  dockerignored - never baked into the image, always created at runtime).
- `src/backend/board.py` - the Kanban API, all behind `require_session`:
  `GET /api/board` (full board, shaped as `{columns: [{id, title,
  cardIds}], cards: {id: {id, title, details}}}` to match
  `frontend/src/lib/kanban.ts`'s types), `PATCH /api/columns/{id}`
  (rename), `POST /api/cards` (create, appended to the column), `PATCH
  /api/cards/{id}` (edit title/details and/or move via `column_id` +
  `position`), `DELETE /api/cards/{id}`. 404 if the column/card doesn't
  belong to the caller's board.

  **All ids in the API are prefixed strings - `"col-3"`, `"card-6"` - not
  bare integers.** `board_columns.id` and `cards.id` are separate SQLite
  autoincrement sequences, both starting at 1, so bare ids collide (column 3
  happens to be "In Progress", card 3 happens to be "Prototype analytics
  view" - unrelated rows, same number). The frontend's drag-and-drop
  (`moveCard()` in `frontend/src/lib/kanban.ts`) identifies whether a
  dnd-kit id is a column or a card by the id's shape alone, so an
  unprefixed collision made it silently treat a card-move as a no-op
  instead of raising an error - the kind of bug that only reproduces for
  *some* ids and passes code review easily. `_column_id`/`_card_id` in
  `board.py` parse the prefix back off (raising 404 on a malformed/wrong
  prefix); `_column_out`/`_card_out` add it back on every response. See
  `test_column_and_card_ids_are_prefixed` in `tests/test_board.py` and the
  Part 7 status note in `docs/PLAN.md`.
- `static/` - static files served at `/`. In the Docker image this is the
  built Next.js export (`frontend/out`, copied in at build time - see the
  root `Dockerfile`). Outside Docker it still holds the Part 2 placeholder
  `index.html` unless you've run the frontend's e2e tests (which build the
  frontend and copy `out/` here via `frontend/scripts/copy-static.mjs`) or
  done so manually.
- `tests/conftest.py` - shared fixtures: `client` (fresh `TestClient` +
  `db.DB_PATH` monkeypatched to a `tmp_path` file, so tests never touch the
  real `data/kanban.db` and don't leak session cookies between tests), and
  `logged_in_client` (same, pre-authenticated).
- `tests/test_main.py`, `test_auth.py`, `test_board.py` - route tests
  mirroring the module split above.

## Card ordering / moves

`board_columns` and `cards` each carry an explicit integer `position`,
unique within their parent (`UNIQUE(board_id, position)` /
`UNIQUE(column_id, position)` - see `docs/database.md` for why). Because
SQLite checks `UNIQUE` immediately (not deferred), naively reassigning
positions can transiently collide with another row's current position
mid-move. `db.set_column_cards` avoids that by parking every affected card
at a negative, per-row-unique position first, then assigning final `0..n-1`
positions in a second pass.

## Running locally

```
uv run --project backend uvicorn backend.main:app --reload
```

## Testing

```
uv run --project backend pytest
```

## Docker

Built and run via the root `Dockerfile` and `scripts/start.*` /
`scripts/stop.*` - see [scripts/CLAUDE.md](../scripts/CLAUDE.md). The image
installs dependencies with `uv sync --locked`, copies `backend/`, and runs
`uv run uvicorn backend.main:app --host 0.0.0.0 --port 8000`.
`OPENROUTER_API_KEY` is passed in at run time from the root `.env` via
`--env-file`, never baked into the image.
