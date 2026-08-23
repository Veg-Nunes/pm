import pytest
from fastapi.testclient import TestClient

from backend import db


def _column_by_title(board: dict, title: str) -> dict:
    return next(column for column in board["columns"] if column["title"] == title)


@pytest.mark.parametrize(
    ("method", "path", "json"),
    [
        ("get", "/api/board", None),
        ("patch", "/api/columns/col-1", {"title": "x"}),
        ("post", "/api/cards", {"column_id": "col-1", "title": "x"}),
        ("patch", "/api/cards/card-1", {"title": "x"}),
        ("delete", "/api/cards/card-1", None),
    ],
)
def test_board_routes_require_session(
    client: TestClient, method: str, path: str, json: dict | None
) -> None:
    response = client.request(method.upper(), path, json=json)
    assert response.status_code == 401


def test_get_board_returns_seeded_columns_and_cards(
    logged_in_client: TestClient,
) -> None:
    response = logged_in_client.get("/api/board")
    assert response.status_code == 200
    body = response.json()

    titles = [column["title"] for column in body["columns"]]
    assert titles == ["Backlog", "Discovery", "In Progress", "Review", "Done"]

    card_counts = [len(column["cardIds"]) for column in body["columns"]]
    assert card_counts == [2, 1, 2, 1, 2]
    assert len(body["cards"]) == 8

    for column in body["columns"]:
        for card_id in column["cardIds"]:
            assert card_id in body["cards"]


def test_rename_column_persists(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    column_id = _column_by_title(board, "Backlog")["id"]

    response = logged_in_client.patch(
        f"/api/columns/{column_id}", json={"title": "Renamed"}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Renamed"

    board_after = logged_in_client.get("/api/board").json()
    assert board_after["columns"][0]["title"] == "Renamed"


def test_rename_missing_column_is_not_found(logged_in_client: TestClient) -> None:
    response = logged_in_client.patch("/api/columns/col-999999", json={"title": "x"})
    assert response.status_code == 404


def test_create_card_appends_and_persists(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    column_id = _column_by_title(board, "Review")["id"]

    response = logged_in_client.post(
        "/api/cards",
        json={"column_id": column_id, "title": "New card", "details": "Notes"},
    )
    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "New card"
    assert created["details"] == "Notes"

    board_after = logged_in_client.get("/api/board").json()
    review = _column_by_title(board_after, "Review")
    assert review["cardIds"][-1] == created["id"]
    assert board_after["cards"][created["id"]]["title"] == "New card"


def test_create_card_in_missing_column_is_not_found(
    logged_in_client: TestClient,
) -> None:
    response = logged_in_client.post(
        "/api/cards", json={"column_id": "col-999999", "title": "x"}
    )
    assert response.status_code == 404


def test_update_card_title_and_details_persists(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    card_id = _column_by_title(board, "Backlog")["cardIds"][0]

    response = logged_in_client.patch(
        f"/api/cards/{card_id}", json={"title": "Updated title", "details": "Updated"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": card_id,
        "title": "Updated title",
        "details": "Updated",
    }

    board_after = logged_in_client.get("/api/board").json()
    assert board_after["cards"][card_id]["title"] == "Updated title"
    assert board_after["cards"][card_id]["details"] == "Updated"


def test_update_missing_card_is_not_found(logged_in_client: TestClient) -> None:
    response = logged_in_client.patch("/api/cards/card-999999", json={"title": "x"})
    assert response.status_code == 404


def test_column_and_card_ids_are_prefixed(logged_in_client: TestClient) -> None:
    # Regression guard: board_columns and cards are separate autoincrement
    # sequences, both starting at 1, so bare integer ids collide (column 3 =
    # "In Progress", card 3 = "Prototype analytics view"). The frontend's
    # moveCard() can't tell them apart without a prefix - it silently no-ops
    # instead of moving the card. See docs/PLAN.md Part 7.
    board = logged_in_client.get("/api/board").json()
    for column in board["columns"]:
        assert column["id"].startswith("col-")
        for card_id in column["cardIds"]:
            assert card_id.startswith("card-")
    assert all(card_id.startswith("card-") for card_id in board["cards"])


def test_move_card_within_column_reorders(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    backlog = _column_by_title(board, "Backlog")
    first_card_id, second_card_id = backlog["cardIds"]

    response = logged_in_client.patch(
        f"/api/cards/{first_card_id}", json={"position": 1}
    )
    assert response.status_code == 200

    board_after = logged_in_client.get("/api/board").json()
    assert _column_by_title(board_after, "Backlog")["cardIds"] == [
        second_card_id,
        first_card_id,
    ]


def test_move_card_to_another_column_persists(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    backlog = _column_by_title(board, "Backlog")
    done = _column_by_title(board, "Done")
    moving_card_id = backlog["cardIds"][0]

    response = logged_in_client.patch(
        f"/api/cards/{moving_card_id}",
        json={"column_id": done["id"], "position": 0},
    )
    assert response.status_code == 200

    board_after = logged_in_client.get("/api/board").json()
    assert moving_card_id not in _column_by_title(board_after, "Backlog")["cardIds"]
    assert _column_by_title(board_after, "Done")["cardIds"][0] == moving_card_id
    assert len(_column_by_title(board_after, "Backlog")["cardIds"]) == 1
    assert len(_column_by_title(board_after, "Done")["cardIds"]) == 3


def test_delete_card_removes_and_persists(logged_in_client: TestClient) -> None:
    board = logged_in_client.get("/api/board").json()
    backlog = _column_by_title(board, "Backlog")
    card_id, remaining_card_id = backlog["cardIds"]

    response = logged_in_client.delete(f"/api/cards/{card_id}")
    assert response.status_code == 204

    board_after = logged_in_client.get("/api/board").json()
    assert _column_by_title(board_after, "Backlog")["cardIds"] == [remaining_card_id]
    assert card_id not in board_after["cards"]


def test_delete_missing_card_is_not_found(logged_in_client: TestClient) -> None:
    response = logged_in_client.delete("/api/cards/card-999999")
    assert response.status_code == 404


def test_database_file_is_recreated_if_deleted(logged_in_client: TestClient) -> None:
    logged_in_client.get("/api/board")
    assert db.DB_PATH.exists()

    db.DB_PATH.unlink()
    assert not db.DB_PATH.exists()

    response = logged_in_client.get("/api/board")
    assert response.status_code == 200
    assert len(response.json()["columns"]) == 5
    assert db.DB_PATH.exists()
