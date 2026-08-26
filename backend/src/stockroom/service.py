from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite
from fastapi import HTTPException, status

from stockroom.database import Database
from stockroom.schemas import (
    Dashboard,
    InventoryItem,
    Location,
    LocationBalance,
    Metrics,
    Movement,
    MovementCreate,
    MovementReceipt,
)

MOVEMENT_SELECT = """
SELECT m.id, m.kind, m.product_id, p.name AS product_name,
       m.from_location_id, source.name AS from_location_name,
       m.to_location_id, destination.name AS to_location_name,
       m.quantity, m.reason, m.actor, m.created_at
FROM movement AS m
JOIN product AS p ON p.id = m.product_id
LEFT JOIN location AS source ON source.id = m.from_location_id
LEFT JOIN location AS destination ON destination.id = m.to_location_id
"""


def _movement(row: aiosqlite.Row) -> Movement:
    return Movement.model_validate(dict(row))


async def dashboard(database: Database) -> Dashboard:
    async with database.connect() as connection:
        locations = [
            Location.model_validate(dict(row))
            async for row in await connection.execute(
                "SELECT id, code, name FROM location ORDER BY code"
            )
        ]
        products = [
            dict(row)
            async for row in await connection.execute(
                "SELECT id, sku, name, unit, reorder_point, unit_cost_cents "
                "FROM product ORDER BY name"
            )
        ]
        balance_rows = [
            dict(row)
            async for row in await connection.execute(
                "SELECT product_id, location_id, quantity, version FROM balance"
            )
        ]
        movements = [
            _movement(row)
            async for row in await connection.execute(
                MOVEMENT_SELECT + " ORDER BY m.created_at DESC LIMIT 40"
            )
        ]

    balances_by_product: dict[str, list[LocationBalance]] = {}
    for row in balance_rows:
        balances_by_product.setdefault(row.pop("product_id"), []).append(
            LocationBalance.model_validate(row)
        )

    items: list[InventoryItem] = []
    for product in products:
        balances = balances_by_product.get(product["id"], [])
        total = sum(balance.quantity for balance in balances)
        item_status = (
            "out" if total == 0 else "low" if total <= product["reorder_point"] else "healthy"
        )
        items.append(
            InventoryItem.model_validate(
                {**product, "total_quantity": total, "status": item_status, "balances": balances}
            )
        )

    today = datetime.now(UTC).date()
    return Dashboard(
        generated_at=datetime.now(UTC),
        metrics=Metrics(
            total_units=sum(item.total_quantity for item in items),
            inventory_value_cents=sum(item.total_quantity * item.unit_cost_cents for item in items),
            low_stock_items=sum(item.status != "healthy" for item in items),
            movements_today=sum(movement.created_at.date() == today for movement in movements),
        ),
        locations=locations,
        items=items,
        movements=movements,
    )


async def _require_balance(
    connection: aiosqlite.Connection,
    product_id: str,
    location_id: str,
) -> aiosqlite.Row:
    cursor = await connection.execute(
        "SELECT quantity, version FROM balance WHERE product_id = ? AND location_id = ?",
        (product_id, location_id),
    )
    row = await cursor.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "inventory balance not found")
    return row


def _check_version(actual: int, expected: int | None) -> None:
    if expected is not None and actual != expected:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "inventory changed since it was loaded; refresh and try again",
        )


async def record_movement(
    database: Database,
    command: MovementCreate,
    idempotency_key: str,
) -> MovementReceipt:
    async with database.connect() as connection:
        await connection.execute("BEGIN IMMEDIATE")
        try:
            cursor = await connection.execute(
                MOVEMENT_SELECT + " WHERE m.idempotency_key = ?",
                (idempotency_key,),
            )
            existing = await cursor.fetchone()
            if existing is not None:
                await connection.rollback()
                return MovementReceipt(movement=_movement(existing), replayed=True)

            product = await (
                await connection.execute(
                    "SELECT id FROM product WHERE id = ?", (command.product_id,)
                )
            ).fetchone()
            if product is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")

            if command.from_location_id:
                source = await _require_balance(
                    connection, command.product_id, command.from_location_id
                )
                _check_version(source["version"], command.expected_source_version)
                if source["quantity"] < command.quantity:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        f"only {source['quantity']} units are available at the source",
                    )
                await connection.execute(
                    "UPDATE balance SET quantity = quantity - ?, version = version + 1 "
                    "WHERE product_id = ? AND location_id = ?",
                    (command.quantity, command.product_id, command.from_location_id),
                )

            if command.to_location_id:
                destination = await _require_balance(
                    connection, command.product_id, command.to_location_id
                )
                _check_version(destination["version"], command.expected_destination_version)
                await connection.execute(
                    "UPDATE balance SET quantity = quantity + ?, version = version + 1 "
                    "WHERE product_id = ? AND location_id = ?",
                    (command.quantity, command.product_id, command.to_location_id),
                )

            movement_id = f"mov-{uuid4().hex[:12]}"
            created_at = datetime.now(UTC).isoformat()
            await connection.execute(
                "INSERT INTO movement "
                "(id, kind, product_id, from_location_id, to_location_id, quantity, reason, "
                "actor, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    movement_id,
                    command.kind,
                    command.product_id,
                    command.from_location_id,
                    command.to_location_id,
                    command.quantity,
                    command.reason,
                    command.actor,
                    created_at,
                    idempotency_key,
                ),
            )
            await connection.commit()
        except Exception:
            await connection.rollback()
            raise

        cursor = await connection.execute(MOVEMENT_SELECT + " WHERE m.id = ?", (movement_id,))
        created = await cursor.fetchone()
        if created is None:
            raise RuntimeError("created movement could not be read")
        return MovementReceipt(movement=_movement(created), replayed=False)
