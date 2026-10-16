## 1.0.1 — 2026-10-16

### Changed
- Credits its author, FlorianBruniaux, on its card.

## 1.0.0 — 2026-10-15

### Added
- Show installed and loaded Ollama models separately from detected MLX or oMLX processes. Offline, stale and invalid sources stay distinct, including cached installed models while Ollama is offline. Detection does not claim active inference. Requires a Fremkit release containing the `local-models` channel from fremkit#17; older hosts show a compatibility message.
