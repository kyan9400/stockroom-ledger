# Changelog

All notable changes are documented here. Versions follow Semantic Versioning.

## [1.1.0] - 2026-08-26

### Added

- Audited cycle-count reconciliation with expected, counted, and variance quantities.
- Optimistic version checks and idempotent replay protection for physical counts.
- Reconciliation workflow, live variance preview, and combined control ledger in the React console.

## [1.0.0] - 2026-08-26

### Added

- Multi-location inventory dashboard with low-stock signals and valuation metrics.
- Atomic receipt, dispatch, and transfer transactions backed by SQLite WAL.
- Idempotent movement requests and optimistic balance version checks.
- Append-only movement trail with actor, reason, route, and timestamp.
- Responsive React interface, typed FastAPI contract, OpenAPI documentation, and seeded data.
- Hardened container, cross-version CI, browser tests, image scanning, and release automation.

[1.0.0]: https://github.com/kyan9400/stockroom-ledger/releases/tag/v1.0.0
[1.1.0]: https://github.com/kyan9400/stockroom-ledger/releases/tag/v1.1.0
