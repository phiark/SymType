# SymType 2.1 Desktop Distribution

SymType 2.1 adds an Apple Silicon macOS distribution layer around the existing React, Fastify,
Node.js, and SQLite product. It does not revise the historical SymType 2.0 scope or any V1 user
function.

- [Desktop distribution decision](DESKTOP-DISTRIBUTION-ADR.md)
- [Requirements and evidence matrix](REQUIREMENTS-MATRIX.md)
- [Performance methodology](PERFORMANCE-METHODOLOGY.md)
- [Release evidence](RELEASE-EVIDENCE.md)
- [Rollback and data preservation](ROLLBACK.md)

Issue #5 and its Pull Request are the delivery records. A DMG is not releasable merely because it
can be created: every automated, manual, performance, CI, and review gate in the matrix must have
recorded evidence.
