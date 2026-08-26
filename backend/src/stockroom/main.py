from __future__ import annotations

import mimetypes
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from stockroom.database import Database
from stockroom.schemas import Dashboard, MovementCreate, MovementReceipt
from stockroom.service import dashboard, record_movement

mimetypes.add_type("application/javascript", ".js")


def create_app(database_path: str | Path | None = None) -> FastAPI:
    configured_path = database_path or os.getenv("STOCKROOM_DATABASE", "data/stockroom.db")
    database = Database(configured_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await database.initialize()
        yield

    app = FastAPI(
        title="Stockroom Ledger API",
        version="1.0.0",
        description="Transactional inventory movements with idempotency and optimistic locking.",
        lifespan=lifespan,
    )
    app.state.database = database

    async def get_database(request: Request) -> Database:
        return request.app.state.database

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Request-ID"] = request.headers.get("X-Request-ID", uuid4().hex)
        return response

    @app.get("/healthz", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/dashboard", response_model=Dashboard, tags=["inventory"])
    async def get_dashboard(db: Database = Depends(get_database)) -> Dashboard:
        return await dashboard(db)

    @app.post(
        "/api/movements",
        response_model=MovementReceipt,
        status_code=status.HTTP_201_CREATED,
        tags=["movements"],
    )
    async def create_movement(
        command: MovementCreate,
        response: Response,
        idempotency_key: str = Header(min_length=8, max_length=120, alias="Idempotency-Key"),
        db: Database = Depends(get_database),
    ) -> MovementReceipt:
        receipt = await record_movement(db, command, idempotency_key)
        if receipt.replayed:
            response.status_code = status.HTTP_200_OK
        return receipt

    frontend = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if frontend.exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def frontend_app(path: str):
            if path.startswith("api/"):
                raise HTTPException(status.HTTP_404_NOT_FOUND)
            return FileResponse(frontend / "index.html")

    return app


app = create_app()
