from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.main import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "kanban.db")
    return TestClient(app)


@pytest.fixture
def logged_in_client(client: TestClient) -> TestClient:
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client
