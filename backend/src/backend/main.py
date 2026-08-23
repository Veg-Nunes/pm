import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from backend import auth, board

ROOT_DIR = Path(__file__).resolve().parents[3]
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"

load_dotenv(ROOT_DIR / ".env")

app = FastAPI(title="Kanban PM API")
app.add_middleware(SessionMiddleware, secret_key=os.environ["SESSION_SECRET_KEY"])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(board.router)

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
