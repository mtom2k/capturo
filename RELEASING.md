# Releasing

## Version and state

1. Update `version` in `package.json` and regenerate `package-lock.json` with `npm install`.
2. Update `PROJECT_STATE.md` and any changed architectural decisions.
3. Run `npm run build` and the platform desktop matrix in `TESTING.md`.

## Windows

Run `npm run dist:win`. The current build configuration produces these x64 artifacts:

- `Capturo-Setup-<version>-x64.exe`
- `Capturo-Portable-<version>-x64.exe`

The NSIS installer is interactive and allows destination selection. The official 0.15.1 release publishes the installer only; the portable executable is local packaging output, stated explicitly in `README.md` and `PROJECT_STATE.md`. Supply a Windows signing certificate through the release environment; local unsigned artifacts will trigger reputation warnings. Before publishing, verify the intended artifact with `Get-AuthenticodeSignature` rather than interpreting electron-builder's `signing with signtool.exe` log as proof that a certificate was applied.

## macOS

Run `npm run dist:mac` on macOS. The package declares the Screen Recording usage description, but distribution still requires an Apple Developer ID certificate, hardened runtime review, notarization, and stapling. Validate both the DMG and ZIP after signing.

## Release acceptance

- Artifact names are distinct and include version and architecture.
- Installed and portable launches are tested independently when both are intended for publication; otherwise the published target is stated consistently in the release notes and project documentation.
- Tray/menu-bar icon is correct at standard and high DPI.
- No capture data is written unless the user chooses Save.
- No network traffic or telemetry is introduced.
- Documentation matches the released behavior and known constraints.
- `CHANGELOG.md` has an Unreleased/release entry, `PROJECT_STATE.md` reflects current work rather than a superseded target, and the documentation-routing checklist in `CONTRIBUTING.md` has been completed.
