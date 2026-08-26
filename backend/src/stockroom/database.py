from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    reorder_point INTEGER NOT NULL CHECK (reorder_point >= 0),
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE TABLE IF NOT EXISTS location (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance (
    product_id TEXT NOT NULL REFERENCES product(id),
    location_id TEXT NOT NULL REFERENCES location(id),
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (product_id, location_id)
);

CREATE TABLE IF NOT EXISTS movement (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'dispatch', 'transfer')),
    product_id TEXT NOT NULL REFERENCES product(id),
    from_location_id TEXT REFERENCES location(id),
    to_location_id TEXT REFERENCES location(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS movement_created_at_idx ON movement(created_at DESC);
CREATE INDEX IF NOT EXISTS movement_product_id_idx ON movement(product_id);

CREATE TABLE IF NOT EXISTS cycle_count (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES product(id),
    location_id TEXT NOT NULL REFERENCES location(id),
    previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
    counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
    variance INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS cycle_count_created_at_idx ON cycle_count(created_at DESC);
CREATE INDEX IF NOT EXISTS cycle_count_product_id_idx ON cycle_count(product_id);
"""

SEED = """
INSERT OR IGNORE INTO location (id, code, name) VALUES
  ('loc-north', 'NTH-01', 'North warehouse'),
  ('loc-studio', 'STD-02', 'Assembly studio'),
  ('loc-retail', 'RTL-03', 'Retail floor');

INSERT OR IGNORE INTO product (id, sku, name, unit, reorder_point, unit_cost_cents) VALUES
  ('prd-lamp', 'LMP-ARC-01', 'Arc task lamp', 'units', 30, 12900),
  ('prd-chair', 'CHR-OAK-02', 'Oak studio chair', 'units', 18, 24800),
  ('prd-shelf', 'SHF-MOD-03', 'Modular shelf', 'units', 14, 18900),
  ('prd-tray', 'TRY-FELT-04', 'Felt document tray', 'units', 35, 4200),
  ('prd-stand', 'STD-MON-05', 'Monitor riser', 'units', 20, 8900);

INSERT OR IGNORE INTO balance (product_id, location_id, quantity, version) VALUES
  ('prd-lamp', 'loc-north', 42, 1), ('prd-lamp', 'loc-retail', 9, 1),
  ('prd-chair', 'loc-north', 11, 1), ('prd-chair', 'loc-studio', 8, 1),
  ('prd-shelf', 'loc-north', 7, 1), ('prd-shelf', 'loc-studio', 4, 1),
  ('prd-tray', 'loc-north', 61, 1), ('prd-tray', 'loc-retail', 12, 1),
  ('prd-stand', 'loc-north', 25, 1), ('prd-stand', 'loc-retail', 6, 1);
"""


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)

    @asynccontextmanager
    async def connect(self) -> AsyncIterator[aiosqlite.Connection]:
        connection = await aiosqlite.connect(self.path)
        connection.row_factory = aiosqlite.Row
        await connection.execute("PRAGMA foreign_keys = ON")
        await connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
        finally:
            await connection.close()

    async def initialize(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        async with self.connect() as connection:
            await connection.executescript(SCHEMA)
            await connection.executescript(SEED)
            await connection.commit()
