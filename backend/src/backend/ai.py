import os
from contextlib import closing
from typing import Literal

import httpx
import truststore
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.auth import require_session
from backend.board import CARD_PREFIX, COLUMN_PREFIX, BoardOut, get_board
from backend.db import (
    create_card,
    ensure_board,
    get_connection,
    get_owned_card,
    get_owned_column,
    move_card,
    update_card_fields,
)

# Uses the OS trust store instead of certifi's bundled CAs - needed on
# networks that TLS-intercept outbound traffic (see frontend/CLAUDE.md's
# note on next/font/google for the same class of problem).
truststore.inject_into_ssl()

router = APIRouter()

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-4o-mini"


def call_openrouter(messages: list[dict], **kwargs) -> dict:
    response = httpx.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
        json={"model": MODEL, "messages": messages, **kwargs},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


class PingResponse(BaseModel):
    answer: str


@router.post("/api/ai/ping")
def ping(username: str = Depends(require_session)) -> PingResponse:
    result = call_openrouter(
        [{"role": "user", "content": "What is 2+2? Answer with only the number."}]
    )
    return PingResponse(answer=result["choices"][0]["message"]["content"].strip())


# --- Board-aware chat -------------------------------------------------

SYSTEM_PROMPT = """You are the AI assistant embedded in a Kanban project \
management app.

You can change the board by adding entries to `operations`. Three actions \
are available:
- create_card: adds a new card to an existing column. Set column_id and \
  title (details optional).
- edit_card: changes an existing card's title and/or details. Set card_id.
- move_card: moves an existing card to a different column and/or position. \
  Set card_id, and column_id and/or position.

You cannot rename, add, or remove columns - only create, edit, and move \
cards. Always use the exact column_id/card_id values from the board JSON \
below - never invent one.

Always write a short, conversational reply in `reply`. When the user asks \
for a board change you can make, actually add the operation(s) - don't \
just describe it in words. If the request doesn't need a board change, \
leave `operations` empty.

Current board:
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


class AiOperation(BaseModel):
    action: Literal["create_card", "edit_card", "move_card"]
    column_id: str | None = None
    card_id: str | None = None
    title: str | None = None
    details: str | None = None
    position: int | None = None


class AiChatResult(BaseModel):
    reply: str
    operations: list[AiOperation]


class ChatResponse(BaseModel):
    reply: str
    boardUpdate: BoardOut | None = None


CHAT_JSON_SCHEMA = {
    "name": "kanban_chat_response",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "reply": {"type": "string"},
            "operations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["create_card", "edit_card", "move_card"],
                        },
                        "column_id": {"type": ["string", "null"]},
                        "card_id": {"type": ["string", "null"]},
                        "title": {"type": ["string", "null"]},
                        "details": {"type": ["string", "null"]},
                        "position": {"type": ["integer", "null"]},
                    },
                    "required": [
                        "action",
                        "column_id",
                        "card_id",
                        "title",
                        "details",
                        "position",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["reply", "operations"],
        "additionalProperties": False,
    },
}


def _parse_prefixed_id(prefix: str, raw: str | None) -> int | None:
    if raw is None or not raw.startswith(prefix):
        return None
    try:
        return int(raw[len(prefix) :])
    except ValueError:
        return None


def _apply_operation(conn, board_id: int, op: AiOperation) -> None:
    # Operations come from the model's own JSON output, not a trusted
    # client - an unparseable/unowned id (hallucinated or stale) just makes
    # this one operation a no-op instead of failing the whole chat turn.
    if op.action == "create_card":
        column_id = _parse_prefixed_id(COLUMN_PREFIX, op.column_id)
        if column_id is None or not op.title:
            return
        if get_owned_column(conn, board_id, column_id) is None:
            return
        create_card(conn, column_id, op.title, op.details or "")

    elif op.action == "edit_card":
        card_id = _parse_prefixed_id(CARD_PREFIX, op.card_id)
        if card_id is None:
            return
        if get_owned_card(conn, board_id, card_id) is None:
            return
        update_card_fields(conn, card_id, op.title, op.details)

    elif op.action == "move_card":
        card_id = _parse_prefixed_id(CARD_PREFIX, op.card_id)
        if card_id is None:
            return
        card = get_owned_card(conn, board_id, card_id)
        if card is None:
            return
        target_column_id = card["column_id"]
        if op.column_id is not None:
            parsed_column_id = _parse_prefixed_id(COLUMN_PREFIX, op.column_id)
            if parsed_column_id is None or (
                get_owned_column(conn, board_id, parsed_column_id) is None
            ):
                return
            target_column_id = parsed_column_id
        move_card(conn, card_id, card["column_id"], target_column_id, op.position)


@router.post("/api/ai/chat")
def chat(body: ChatRequest, username: str = Depends(require_session)) -> ChatResponse:
    board = get_board(username)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + board.model_dump_json()},
        *({"role": turn.role, "content": turn.content} for turn in body.history),
        {"role": "user", "content": body.message},
    ]

    completion = call_openrouter(
        messages,
        response_format={"type": "json_schema", "json_schema": CHAT_JSON_SCHEMA},
    )
    result = AiChatResult.model_validate_json(
        completion["choices"][0]["message"]["content"]
    )

    if not result.operations:
        return ChatResponse(reply=result.reply)

    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        for operation in result.operations:
            _apply_operation(conn, board_id, operation)
        conn.commit()

    return ChatResponse(reply=result.reply, boardUpdate=get_board(username))
