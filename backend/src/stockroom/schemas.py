from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Location(APIModel):
    id: str
    code: str
    name: str


class LocationBalance(APIModel):
    location_id: str
    quantity: int
    version: int


class InventoryItem(APIModel):
    id: str
    sku: str
    name: str
    unit: str
    reorder_point: int
    unit_cost_cents: int
    total_quantity: int
    status: Literal["healthy", "low", "out"]
    balances: list[LocationBalance]


class Movement(APIModel):
    id: str
    kind: Literal["receipt", "dispatch", "transfer"]
    product_id: str
    product_name: str
    from_location_id: str | None
    from_location_name: str | None
    to_location_id: str | None
    to_location_name: str | None
    quantity: int
    reason: str
    actor: str
    created_at: datetime


class Metrics(APIModel):
    total_units: int
    inventory_value_cents: int
    low_stock_items: int
    movements_today: int


class Dashboard(APIModel):
    generated_at: datetime
    metrics: Metrics
    locations: list[Location]
    items: list[InventoryItem]
    movements: list[Movement]


class MovementCreate(APIModel):
    kind: Literal["receipt", "dispatch", "transfer"]
    product_id: str = Field(min_length=1, max_length=80)
    from_location_id: str | None = Field(default=None, max_length=80)
    to_location_id: str | None = Field(default=None, max_length=80)
    quantity: int = Field(ge=1, le=1_000_000)
    reason: str = Field(min_length=3, max_length=180)
    actor: str = Field(min_length=2, max_length=80)
    expected_source_version: int | None = Field(default=None, ge=1)
    expected_destination_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_route(self) -> MovementCreate:
        if self.kind == "receipt" and (self.from_location_id or not self.to_location_id):
            raise ValueError("receipts require only a destination")
        if self.kind == "dispatch" and (not self.from_location_id or self.to_location_id):
            raise ValueError("dispatches require only a source")
        if self.kind == "transfer":
            if not self.from_location_id or not self.to_location_id:
                raise ValueError("transfers require a source and destination")
            if self.from_location_id == self.to_location_id:
                raise ValueError("transfer locations must be different")
        if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,79}", self.actor):
            raise ValueError("actor must be a readable name")
        return self


class MovementReceipt(APIModel):
    movement: Movement
    replayed: bool
