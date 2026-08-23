from fastapi.testclient import TestClient


def test_me_without_session_is_unauthorized(client: TestClient) -> None:
    response = client.get("/api/me")
    assert response.status_code == 401


def test_login_with_wrong_credentials_is_unauthorized(client: TestClient) -> None:
    response = client.post(
        "/api/login", json={"username": "user", "password": "wrong"}
    )
    assert response.status_code == 401


def test_login_with_correct_credentials_starts_session(client: TestClient) -> None:
    login_response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200
    assert login_response.json() == {"username": "user"}

    me_response = client.get("/api/me")
    assert me_response.status_code == 200
    assert me_response.json() == {"username": "user"}


def test_logout_clears_session(client: TestClient) -> None:
    client.post("/api/login", json={"username": "user", "password": "password"})

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200

    me_response = client.get("/api/me")
    assert me_response.status_code == 401
