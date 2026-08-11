# Contributing

## Principles

- Preserve the direct tray-to-capture workflow.
- Prefer platform-native behavior and plain language.
- Keep the renderer dependency-free unless a feature is materially safer or smaller with a library.
- Keep native privileges in the main process and expose narrow typed IPC methods.
- Treat captured pixels as sensitive: no network transfer, logging, analytics, or persistence without explicit user action.
- Keep the project documentation synchronized with behavior as part of every change; use the routing checklist below.

## Documentation maintenance

Before handing off or merging a behavioral change, review each document by purpose:

- `README.md`: current user-visible behavior, availability, shortcuts, limitations, and privacy claims.
- `CHANGELOG.md`: add an **Unreleased** entry for user-visible fixes and features; do not rewrite historical releases to describe later behavior.
- `PROJECT_STATE.md`: current release/development state, completed verification, and genuinely outstanding work.
- `ARCHITECTURE.md`: current process boundaries, data flow, storage, timing, and security invariants.
- `DECISIONS.md`: durable design choices, trade-offs, and amendments that explain why the implementation must remain a certain way.
- `TESTING.md`: automated regressions and the manual desktop checks needed to prove the changed behavior.
- `HANDOFF.md`: implementation map, fragile invariants, and the shortest accurate path for the next developer or LLM.
- `RELEASING.md`: packaging/signing expectations and the documentation checks required before a release.

Update present-tense claims immediately when they change. Keep dated historical results intact, label superseded guidance clearly, and update any "Last updated" marker in the same change.

## Definition of done

1. Type checking passes.
2. Geometry/model tests pass.
3. Production build passes.
4. The changed workflow is exercised in the desktop app.
5. The document-routing checklist above has been reviewed and every affected Markdown file matches the implemented behavior.
