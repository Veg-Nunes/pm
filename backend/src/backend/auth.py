from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

HARDCODED_USERNAME = "user"
HARDCODED_PASSWORD = "password"

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class SessionResponse(BaseModel):
    username: str


def require_session(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return username


@router.post("/api/login")
def login(credentials: LoginRequest, request: Request) -> SessionResponse:
    if (
        credentials.username != HARDCODED_USERNAME
        or credentials.password != HARDCODED_PASSWORD
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["username"] = credentials.username
    return SessionResponse(username=credentials.username)


@router.post("/api/logout")
def logout(request: Request) -> dict[str, str]:
    request.session.clear()
    return {"status": "ok"}


@router.get("/api/me")
def me(username: str = Depends(require_session)) -> SessionResponse:
    return SessionResponse(username=username)
