# Releasing

## Version and state

1. Update `version` in `package.json` and regenerate `package-lock.json` with `npm install`.
2. Update `PROJECT_STATE.md` and any changed architectural decisions.
3. Run `npm run build` and the platform desktop matrix in `TESTING.md`.

## Windows

Run `npm run dist:win`. Expected x64 artifacts:

- `Capturo-Setup-<version>-x64.exe`
- `Capturo-Portable-<version>-x64.exe`

The NSIS installer is interactive and allows destination selection. Supply a Windows signing certificate through the release environment; local unsigned artifacts will trigger reputation warnings.

## macOS

Run `npm run dist:mac` on macOS. The package declares the Screen Recording usage description, but distribution still requires an Apple Developer ID certificate, hardened runtime review, notarization, and stapling. Validate both the DMG and ZIP after signing.

## Release acceptance

- Artifact names are distinct and include version and architecture.
- Installed and portable launches are tested independently.
- Tray/menu-bar icon is correct at standard and high DPI.
- No capture data is written unless the user chooses Save.
- No network traffic or telemetry is introduced.
- Documentation matches the released behavior and known constraints.
