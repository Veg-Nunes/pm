# AI Chat: request/response shape

`POST /api/ai/chat` (`backend/src/backend/ai.py`), added in Part 9. This
document explains the design; see `backend/CLAUDE.md` for the implementation
summary.

## Request

```json
{ "message": "add a card called X to Backlog", "history": [{"role": "user" | "assistant", "content": "..."}] }
```

`history` is the prior turns of this conversation, passed straight through
as OpenRouter chat messages so the model has context across turns. The
frontend owns keeping this list (Part 10); the backend is stateless per
request.

## What the model sees

The system prompt plus the *current* board (fetched fresh via the same
`get_board()` Part 6/7 use for `GET /api/board`) is sent as the system
message on every call - not cached, not diffed - so the model always
reasons about the real current state, including changes made in the same
conversation. The prompt spells out exactly three capabilities (create,
edit, move a card) and explicitly rules out column operations, and requires
`column_id`/`card_id` values to come from that board JSON verbatim.

## `boardUpdate`: full board, not a patch

The plan phrased this as "board patch/full board" - a decision to make.
Chosen: **full board**, i.e. `boardUpdate` is the same `BoardOut` shape as
`GET /api/board`, present only when at least one change was actually
applied (`null` otherwise). Reasons:

- The board is small (one board, a handful of columns and cards) - there's
  no meaningful cost to sending the whole thing versus a diff.
- The frontend already knows how to render a full `BoardData` (it's exactly
  what `fetchBoard()` returns) - reusing that shape means Part 10 doesn't
  need a second "apply a patch" code path alongside the one it already has
  for the initial load.
- A patch format shifts complexity onto the model (it would have to emit a
  diff-shaped operation on top of already emitting write operations) for no
  benefit at this scale.

## `operations`: the model's output, not the API's output

Internally, structured-output responses from the model use a different,
smaller shape - a flat list of `operations`, each one `{action: "create_card"
| "edit_card" | "move_card", column_id, card_id, title, details, position}`
(all fields present and nullable, per OpenRouter/OpenAI strict-mode JSON
schema rules - `additionalProperties: false`, every property listed in
`required`). This is intentionally *not* the same shape as `boardUpdate`:
it's an instruction list ("do these things"), not a board snapshot. The
route applies each operation against the real database (reusing
`backend/db.py`'s `create_card`, `update_card_fields`, `move_card` - the
same functions `board.py`'s CRUD routes use) and only then builds the
`boardUpdate` snapshot from the result.

Reusing the three card-level primitives instead of inventing an "apply a
full board diff" function keeps the AI path exercising the same persistence
code the human-driven Kanban UI already exercises and has tests for -
rather than a second, parallel way to mutate the board that could drift out
of sync with it.

## Bad/hallucinated ids fail soft

An operation with an unparseable id, or an id that doesn't belong to this
user's board, is simply skipped - not an error response. The model's JSON
output isn't a trusted client request in the usual sense (it's not hitting
`board.py`'s routes, which do 404 on a bad id); a hallucinated id here is a
model mistake, not an attempted unauthorized action, so the right behavior
is "don't apply that one part" rather than failing the whole chat turn over
it. See `test_chat_ignores_hallucinated_id_without_erroring` in
`backend/tests/test_ai.py`.
