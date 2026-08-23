# Database

Schema definitions: [schema.json](schema.json). This document explains the
reasoning; Part 6 implements it.

## Why SQLite

Already the tech decision in root `CLAUDE.md`: the app runs locally in a
single Docker container for one user, so a local file database is simplest
- no separate DB service/container, no network config, and Python's
standard library talks to it directly. File lives at
`backend/data/kanban.db`, created on first run if it doesn't exist (per the
CLAUDE.md requirement); `backend/data/` is gitignored.

## Tables

Four tables, normalized (`schema.json` has full column/type/constraint
detail):

- **users** - one row per user. The MVP login (Part 4) is a hardcoded
  `user`/`password` check in code, not a DB lookup, but root `CLAUDE.md`
  requires the database to "support multiple users for future" - so the
  table has `username` + `password_hash` now, even though `password_hash`
  isn't read yet. Part 6 seeds a single `user` row on first run (see
  below); nothing in the schema is MVP-only besides that seed.
- **boards** - one row per board, `user_id` with a `UNIQUE` constraint. That
  constraint is the entire enforcement of "one board per user" from the
  MVP's Limitations section - removing it is the only change needed to
  support multiple boards per user later.
- **board_columns** - a Kanban column (title + position). Named
  `board_columns` rather than `columns` to avoid clashing with the SQL term
  "column" in conversation and in code.
- **cards** - title, details, position, belongs to one `board_columns` row.

All foreign keys `ON DELETE CASCADE`: deleting a user drops their board,
columns, and cards; deleting a board drops its columns and cards; deleting
a column drops its cards. Nothing in the MVP deletes users or boards, but
cascading is the correct behavior if it ever does, and it's free to declare
now.

## Ordering: explicit `position` column

The frontend's in-memory model (`frontend/src/lib/kanban.ts`) orders cards
via a `cardIds: string[]` array per column. The database instead gives
`board_columns` and `cards` each an integer `position` column, unique
within their parent (`(board_id, position)` / `(column_id, position)`).

Chosen over a linked-list style (`previous_card_id` / `next_card_id`)
because:
- Fetching a column's cards in order is `ORDER BY position` - no recursive
  walk needed.
- Board sizes are small (one board, a handful of columns, a modest number
  of cards), so the cost of renumbering siblings on a reorder (an `UPDATE`
  per affected row) is negligible - the usual reason to prefer a linked
  list (avoiding O(n) updates on reorder) doesn't apply here.
- Simpler to implement and reason about, matching the project's "keep it
  simple" standard.

Part 6's API layer converts between this flat, ordered representation and
the frontend's nested `{ columns, cards }` JSON shape (order cards by
`position` within each column when building the response; reassign
`position` values when persisting a reorder).

## Mapping the hardcoded user to a DB row

Login (Part 4) still checks the hardcoded `user`/`password` in code - that
doesn't change. What Part 6 adds: on startup (or first authenticated
request), if no `users` row with `username = 'user'` exists, create one
(with a placeholder `password_hash`, unused), and if that user has no
`boards` row, create one seeded with the current frontend demo's columns
and cards (`frontend/src/lib/kanban.ts#initialData`) so the first login
sees the same board it does today. This is the only place "hardcoded user"
and "database" meet - authentication itself stays code-only for the MVP.

## Migrations

No migration tool. `CREATE TABLE IF NOT EXISTS` for all four tables, run on
backend startup, matches "creating a new db if it doesn't exist" from root
`CLAUDE.md` and needs nothing beyond the standard library. If the schema
changes after data exists, that's handled by hand at the time (single local
SQLite file, no production data to migrate) rather than building a
migration framework now.
