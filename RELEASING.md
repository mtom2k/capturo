# Releasing

## Version and state

1. Update `version` in `package.json` and regenerate `package-lock.json` with `npm install`.
2. Update `PROJECT_STATE.md` and any changed architectural decisions.
3. Run `npm run build` and the platform desktop matrix in `TESTING.md`.
4. Publish a stable `vMAJOR.MINOR.PATCH` GitHub Release only after its Windows installer has
   passed acceptance. The in-app checker deliberately ignores repository commits, drafts,
   prereleases, and non-semantic tags.

## Windows

Run `npm run dist:win`. The current build configuration produces these x64 artifacts:

- `Capturo-Setup-<version>-x64.exe`
- `Capturo-Portable-<version>-x64.exe`

The NSIS installer is interactive and allows destination selection. The official 0.18.0 release publishes the installer only; the portable executable is local packaging output, stated explicitly in `README.md` and `PROJECT_STATE.md`. Supply a Windows signing certificate through the release environment; local unsigned artifacts will trigger reputation warnings. Before publishing, verify the intended artifact with `Get-AuthenticodeSignature` rather than interpreting electron-builder's `signing with signtool.exe` log as proof that a certificate was applied.

The current updater is notification-only: it checks the public GitHub Release version and opens
the official Releases page, but never downloads or installs an artifact. Do not introduce silent
installation while Windows artifacts remain unsigned. A future `electron-updater` rollout must
publish the NSIS installer, its blockmap, and `latest.yml` from the same signed build, and must be
tested from an installed prior version; portable builds should remain notification-only.

The release feed must remain anonymously readable. `mtom2k/capturo` became public on 2026-08-13,
and its anonymous latest-release API was verified against stable `v0.15.1`. Re-test that endpoint
before every release. If releases move to a dedicated public repository, update both fixed Capturo
URLs and repeat the packaged smoke. Never embed a GitHub token in the application.

`v0.15.1` predates the update checker, so it cannot notify its own users about the first
checker-enabled release. Publish and announce that first upgrade through the existing GitHub and
README download path; in-app discovery applies to subsequent stable releases.

Rebuild `native/capturo-capture/build/capturo-capture.exe` before Windows packaging whenever its
source changes. For releases containing Copy text, verify the packaged helper (not only the
development executable) recognizes a representative image with the current user's Windows OCR
language, writes plain text through the real application clipboard path, and leaves no screenshot
file behind. OCR is local and Windows-only; do not add a model download or claim macOS support.

## macOS

Run `npm run dist:mac` on macOS. The package declares the Screen Recording usage description, but distribution still requires an Apple Developer ID certificate, hardened runtime review, notarization, and stapling. Validate both the DMG and ZIP after signing.

## Release acceptance

- Artifact names are distinct and include version and architecture.
- Installed and portable launches are tested independently when both are intended for publication; otherwise the published target is stated consistently in the release notes and project documentation.
- Tray/menu-bar icon is correct at standard and high DPI.
- No capture data is written unless the user chooses Save or explicitly copies an unsaved GIF.
- Copy text uses the packaged local helper, requires no network, and reports missing/no-text cases without closing the editor.
- No unexpected network traffic or telemetry is introduced; the optional GitHub release check must match the documented privacy boundary.
- Documentation matches the released behavior and known constraints.
- `CHANGELOG.md` has an Unreleased/release entry, `PROJECT_STATE.md` reflects current work rather than a superseded target, and the documentation-routing checklist in `CONTRIBUTING.md` has been completed.
