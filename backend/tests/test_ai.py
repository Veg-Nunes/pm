import json
import os

import pytest
from fastapi.testclient import TestClient

from backend import ai

requires_api_key = pytest.mark.skipif(
    not os.environ.get("OPENROUTER_API_KEY"),
    reason="requires a real OPENROUTER_API_KEY",
)


def _fake_completion(payload: dict) -> dict:
    return {"choices": [{"message": {"content": json.dumps(payload)}}]}


def _column_by_title(board: dict, title: str) -> dict:
    return next(column for column in board["columns"] if column["title"] == title)


def test_ping_requires_session(client: TestClient) -> None:
    response = client.post("/api/ai/ping")
    assert response.status_code == 401


@requires_api_key
def test_ping_asks_openrouter_and_gets_four(logged_in_client: TestClient) -> None:
    response = logged_in_client.post("/api/ai/ping")
    assert response.status_code == 200
    assert "4" in response.json()["answer"]


def test_chat_requires_session(client: TestClient) -> None:
    response = client.post("/api/ai/chat", json={"message": "hi"})
    assert response.status_code == 401


def test_chat_reply_only_leaves_board_unchanged(
    logged_in_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ai,
        "call_openrouter",
        lambda *a, **k: _fake_completion({"reply": "Sure thing!", "operations": []}),
    )
    board_before = logged_in_client.get("/api/board").json()

    response = logged_in_client.post("/api/ai/chat", json={"message": "hello"})
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Sure thing!"
    assert body["boardUpdate"] is None

    board_after = logged_in_client.get("/api/board").json()
    assert board_after == board_before


def test_chat_create_card_operation_persists(
    logged_in_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    board = logged_in_client.get("/api/board").json()
    backlog_id = _column_by_title(board, "Backlog")["id"]
    monkeypatch.setattr(
        ai,
        "call_openrouter",
        lambda *a, **k: _fake_completion(
            {
                "reply": "Added it.",
                "operations": [
                    {
                        "action": "create_card",
                        "column_id": backlog_id,
                        "card_id": None,
                        "title": "New AI card",
                        "details": "from chat",
                        "position": None,
                    }
                ],
            }
        ),
    )

    response = logged_in_client.post(
        "/api/ai/chat", json={"message": "add a card to backlog"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["boardUpdate"] is not None
    backlog_after = _column_by_title(body["boardUpdate"], "Backlog")
    new_card_ids = [
        card_id
        for card_id in backlog_after["cardIds"]
        if body["boardUpdate"]["cards"][card_id]["title"] == "New AI card"
    ]
    assert len(new_card_ids) == 1

    board_after = logged_in_client.get("/api/board").json()
    assert board_after["cards"][new_card_ids[0]]["details"] == "from chat"


def test_chat_move_card_operation_persists(
    logged_in_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    board = logged_in_client.get("/api/board").json()
    backlog = _column_by_title(board, "Backlog")
    done = _column_by_title(board, "Done")
    moving_card_id = backlog["cardIds"][0]
    monkeypatch.setattr(
        ai,
        "call_openrouter",
        lambda *a, **k: _fake_completion(
            {
                "reply": "Moved it.",
                "operations": [
                    {
                        "action": "move_card",
                        "column_id": done["id"],
                        "card_id": moving_card_id,
                        "title": None,
                        "details": None,
                        "position": 0,
                    }
                ],
            }
        ),
    )

    response = logged_in_client.post("/api/ai/chat", json={"message": "move it"})
    assert response.status_code == 200

    board_after = logged_in_client.get("/api/board").json()
    assert _column_by_title(board_after, "Done")["cardIds"][0] == moving_card_id
    assert moving_card_id not in _column_by_title(board_after, "Backlog")["cardIds"]


def test_chat_ignores_hallucinated_id_without_erroring(
    logged_in_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    board_before = logged_in_client.get("/api/board").json()
    monkeypatch.setattr(
        ai,
        "call_openrouter",
        lambda *a, **k: _fake_completion(
            {
                "reply": "Done.",
                "operations": [
                    {
                        "action": "edit_card",
                        "column_id": None,
                        "card_id": "card-999999",
                        "title": "Should not apply",
                        "details": None,
                        "position": None,
                    }
                ],
            }
        ),
    )

    response = logged_in_client.post("/api/ai/chat", json={"message": "edit ghost"})
    assert response.status_code == 200

    board_after = logged_in_client.get("/api/board").json()
    assert board_after == board_before


@requires_api_key
def test_chat_real_call_adds_a_card_to_backlog(logged_in_client: TestClient) -> None:
    response = logged_in_client.post(
        "/api/ai/chat",
        json={"message": "Add a card called 'Buy stapler' to the Backlog column."},
    )
    assert response.status_code == 200

    board_after = logged_in_client.get("/api/board").json()
    backlog = _column_by_title(board_after, "Backlog")
    titles = [board_after["cards"][card_id]["title"] for card_id in backlog["cardIds"]]
    assert any("stapler" in title.lower() for title in titles)
