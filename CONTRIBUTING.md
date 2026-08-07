# Contributing

## Principles

- Preserve the direct tray-to-capture workflow.
- Prefer platform-native behavior and plain language.
- Keep the renderer dependency-free unless a feature is materially safer or smaller with a library.
- Keep native privileges in the main process and expose narrow typed IPC methods.
- Treat captured pixels as sensitive: no network transfer, logging, analytics, or persistence without explicit user action.
- Update `ARCHITECTURE.md`, `DECISIONS.md`, `PROJECT_STATE.md`, and `HANDOFF.md` when their claims change.

## Definition of done

1. Type checking passes.
2. Geometry/model tests pass.
3. Production build passes.
4. The changed workflow is exercised in the desktop app.
5. Project documentation matches the shipped behavior.
