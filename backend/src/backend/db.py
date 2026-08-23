import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "kanban.db"

SEED_COLUMNS = [
    {
        "title": "Backlog",
        "cards": [
            {
                "title": "Align roadmap themes",
                "details": "Draft quarterly themes with impact statements and metrics.",
            },
            {
                "title": "Gather customer signals",
                "details": "Review support tags, sales notes, and churn feedback.",
            },
        ],
    },
    {
        "title": "Discovery",
        "cards": [
            {
                "title": "Prototype analytics view",
                "details": "Sketch initial dashboard layout and key drill-downs.",
            },
        ],
    },
    {
        "title": "In Progress",
        "cards": [
            {
                "title": "Refine status language",
                "details": "Standardize column labels and tone across the board.",
            },
            {
                "title": "Design card layout",
                "details": "Add hierarchy and spacing for scanning dense lists.",
            },
        ],
    },
    {
        "title": "Review",
        "cards": [
            {
                "title": "QA micro-interactions",
                "details": "Verify hover, focus, and loading states.",
            },
        ],
    },
    {
        "title": "Done",
        "cards": [
            {
                "title": "Ship marketing page",
                "details": "Final copy approved and asset pack delivered.",
            },
            {
                "title": "Close onboarding sprint",
                "details": "Document release notes and share internally.",
            },
        ],
    },
]


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS board_columns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            position INTEGER NOT NULL,
            UNIQUE (board_id, position)
        );

        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            column_id INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL,
            UNIQUE (column_id, position)
        );
        """
    )
    conn.commit()


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    return conn


def ensure_board(conn: sqlite3.Connection, username: str) -> int:
    user_row = conn.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if user_row is None:
        user_id = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, ""),
        ).lastrowid
    else:
        user_id = user_row["id"]

    board_row = conn.execute(
        "SELECT id FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    if board_row is not None:
        return board_row["id"]

    board_id = conn.execute(
        "INSERT INTO boards (user_id) VALUES (?)", (user_id,)
    ).lastrowid
    for column_position, column in enumerate(SEED_COLUMNS):
        column_id = conn.execute(
            "INSERT INTO board_columns (board_id, title, position) VALUES (?, ?, ?)",
            (board_id, column["title"], column_position),
        ).lastrowid
        for card_position, card in enumerate(column["cards"]):
            conn.execute(
                "INSERT INTO cards (column_id, title, details, position) VALUES (?, ?, ?, ?)",
                (column_id, card["title"], card["details"], card_position),
            )
    conn.commit()
    return board_id


def get_owned_column(
    conn: sqlite3.Connection, board_id: int, column_id: int
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id FROM board_columns WHERE id = ? AND board_id = ?",
        (column_id, board_id),
    ).fetchone()


def get_owned_card(
    conn: sqlite3.Connection, board_id: int, card_id: int
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT cards.id, cards.column_id
        FROM cards
        JOIN board_columns ON board_columns.id = cards.column_id
        WHERE cards.id = ? AND board_columns.board_id = ?
        """,
        (card_id, board_id),
    ).fetchone()


def create_card(
    conn: sqlite3.Connection, column_id: int, title: str, details: str = ""
) -> int:
    position = conn.execute(
        "SELECT COUNT(*) AS count FROM cards WHERE column_id = ?", (column_id,)
    ).fetchone()["count"]
    return conn.execute(
        "INSERT INTO cards (column_id, title, details, position) VALUES (?, ?, ?, ?)",
        (column_id, title, details, position),
    ).lastrowid


def update_card_fields(
    conn: sqlite3.Connection,
    card_id: int,
    title: str | None,
    details: str | None,
) -> None:
    current = conn.execute(
        "SELECT title, details FROM cards WHERE id = ?", (card_id,)
    ).fetchone()
    conn.execute(
        "UPDATE cards SET title = ?, details = ? WHERE id = ?",
        (
            title if title is not None else current["title"],
            details if details is not None else current["details"],
            card_id,
        ),
    )


def set_column_cards(
    conn: sqlite3.Connection, column_id: int, ordered_card_ids: list[int]
) -> None:
    # Park at a position guaranteed unique (negative, keyed by each card's own
    # id) first, since UNIQUE(column_id, position) is checked immediately and
    # a direct reassignment can transiently collide with another row's
    # current position.
    for card_id in ordered_card_ids:
        conn.execute(
            "UPDATE cards SET position = ? WHERE id = ?", (-card_id, card_id)
        )
    for index, card_id in enumerate(ordered_card_ids):
        conn.execute(
            "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
            (column_id, index, card_id),
        )


def move_card(
    conn: sqlite3.Connection,
    card_id: int,
    source_column_id: int,
    target_column_id: int,
    target_position: int | None,
) -> None:
    source_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
            (source_column_id,),
        ).fetchall()
    ]
    if card_id in source_ids:
        source_ids.remove(card_id)

    if target_column_id == source_column_id:
        dest_ids = source_ids
    else:
        dest_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM cards WHERE column_id = ? ORDER BY position",
                (target_column_id,),
            ).fetchall()
        ]

    insert_at = len(dest_ids) if target_position is None else target_position
    insert_at = max(0, min(insert_at, len(dest_ids)))
    dest_ids.insert(insert_at, card_id)

    set_column_cards(conn, target_column_id, dest_ids)
    if target_column_id != source_column_id:
        set_column_cards(conn, source_column_id, source_ids)
