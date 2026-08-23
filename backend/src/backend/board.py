from contextlib import closing

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import require_session
from backend.db import (
    create_card as db_create_card,
    ensure_board,
    get_connection,
    get_owned_card,
    get_owned_column,
    move_card,
    set_column_cards,
    update_card_fields,
)

router = APIRouter()

COLUMN_PREFIX = "col-"
CARD_PREFIX = "card-"


def _parse_id(prefix: str, raw: str) -> int:
    if not raw.startswith(prefix):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        return int(raw[len(prefix) :])
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")


def _column_id(raw: str) -> int:
    return _parse_id(COLUMN_PREFIX, raw)


def _card_id(raw: str) -> int:
    return _parse_id(CARD_PREFIX, raw)


class CardOut(BaseModel):
    id: str
    title: str
    details: str


class ColumnOut(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class BoardOut(BaseModel):
    columns: list[ColumnOut]
    cards: dict[str, CardOut]


class ColumnRenameRequest(BaseModel):
    title: str


class CardCreateRequest(BaseModel):
    column_id: str
    title: str
    details: str = ""


class CardUpdateRequest(BaseModel):
    title: str | None = None
    details: str | None = None
    column_id: str | None = None
    position: int | None = None


def _get_owned_column(conn, board_id: int, column_id: int):
    row = get_owned_column(conn, board_id, column_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Column not found")
    return row


def _get_owned_card(conn, board_id: int, card_id: int):
    row = get_owned_card(conn, board_id, card_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return row


def _column_out(conn, column_id: int, title: str) -> ColumnOut:
    cards = conn.execute(
        "SELECT id FROM cards WHERE column_id = ? ORDER BY position", (column_id,)
    ).fetchall()
    return ColumnOut(
        id=f"{COLUMN_PREFIX}{column_id}",
        title=title,
        cardIds=[f"{CARD_PREFIX}{card['id']}" for card in cards],
    )


def _card_out(row) -> CardOut:
    return CardOut(
        id=f"{CARD_PREFIX}{row['id']}", title=row["title"], details=row["details"]
    )


@router.get("/api/board")
def get_board(username: str = Depends(require_session)) -> BoardOut:
    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        columns = conn.execute(
            "SELECT id, title FROM board_columns WHERE board_id = ? ORDER BY position",
            (board_id,),
        ).fetchall()

        column_outs = []
        card_outs: dict[str, CardOut] = {}
        for column in columns:
            cards = conn.execute(
                "SELECT id, title, details FROM cards WHERE column_id = ? ORDER BY position",
                (column["id"],),
            ).fetchall()
            for card in cards:
                card_out = _card_out(card)
                card_outs[card_out.id] = card_out
            column_outs.append(
                ColumnOut(
                    id=f"{COLUMN_PREFIX}{column['id']}",
                    title=column["title"],
                    cardIds=[f"{CARD_PREFIX}{card['id']}" for card in cards],
                )
            )

        return BoardOut(columns=column_outs, cards=card_outs)


@router.patch("/api/columns/{column_id}")
def rename_column(
    column_id: str,
    body: ColumnRenameRequest,
    username: str = Depends(require_session),
) -> ColumnOut:
    parsed_column_id = _column_id(column_id)
    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        _get_owned_column(conn, board_id, parsed_column_id)
        conn.execute(
            "UPDATE board_columns SET title = ? WHERE id = ?",
            (body.title, parsed_column_id),
        )
        conn.commit()
        return _column_out(conn, parsed_column_id, body.title)


@router.post("/api/cards", status_code=201)
def create_card(
    body: CardCreateRequest, username: str = Depends(require_session)
) -> CardOut:
    parsed_column_id = _column_id(body.column_id)
    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        _get_owned_column(conn, board_id, parsed_column_id)
        card_id = db_create_card(conn, parsed_column_id, body.title, body.details)
        conn.commit()
        return CardOut(
            id=f"{CARD_PREFIX}{card_id}", title=body.title, details=body.details
        )


@router.patch("/api/cards/{card_id}")
def update_card(
    card_id: str,
    body: CardUpdateRequest,
    username: str = Depends(require_session),
) -> CardOut:
    parsed_card_id = _card_id(card_id)
    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        card = _get_owned_card(conn, board_id, parsed_card_id)

        if body.title is not None or body.details is not None:
            update_card_fields(conn, parsed_card_id, body.title, body.details)

        if body.column_id is not None or body.position is not None:
            target_column_id = (
                _column_id(body.column_id)
                if body.column_id is not None
                else card["column_id"]
            )
            _get_owned_column(conn, board_id, target_column_id)
            move_card(
                conn, parsed_card_id, card["column_id"], target_column_id, body.position
            )

        conn.commit()
        final = conn.execute(
            "SELECT id, title, details FROM cards WHERE id = ?", (parsed_card_id,)
        ).fetchone()
        return _card_out(final)


@router.delete("/api/cards/{card_id}", status_code=204)
def delete_card(card_id: str, username: str = Depends(require_session)) -> None:
    parsed_card_id = _card_id(card_id)
    with closing(get_connection()) as conn:
        board_id = ensure_board(conn, username)
        card = _get_owned_card(conn, board_id, parsed_card_id)
        conn.execute("DELETE FROM cards WHERE id = ?", (parsed_card_id,))
        remaining_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                (card["column_id"],),
            ).fetchall()
        ]
        set_column_cards(conn, card["column_id"], remaining_ids)
        conn.commit()
