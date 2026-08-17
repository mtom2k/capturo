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

The NSIS installer is interactive and allows destination selection. Official releases publish the installer only; the portable executable is local packaging output, stated explicitly in `README.md` and `PROJECT_STATE.md`. Supply a Windows signing certificate through the release environment; local unsigned artifacts will trigger reputation warnings. Before publishing, verify the intended artifact with `Get-AuthenticodeSignature` rather than interpreting electron-builder's `signing with signtool.exe` log as proof that a certificate was applied.

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

Run `npm run dist:mac` on macOS. It produces `Capturo-<version>-<arch>.dmg` and
`Capturo-<version>-<arch>-mac.zip` for the host architecture only; an Intel or universal build
needs an explicit `--x64` or `--universal`. The Windows native helper is scoped to the `win`
target, so a macOS build does not need `native/capturo-capture/build` to exist.

`scripts/sign-mac.mjs` runs as an `afterPack` hook and signs the app before the DMG and ZIP are
produced. Without it electron-builder leaves the bundle linker-signed with the identifier
`Electron` and no sealed resources, which macOS treats as damaged. It prefers a Developer ID
certificate (standing aside so electron-builder signs), then a stable local certificate, then
ad-hoc. Verify a build with `codesign --verify --deep --strict` and read the identity with
`codesign -dv --verbose=2`; a good local build reports `Identifier=com.capturo.app` and
`Sealed Resources version=2`.

### Why macOS keeps asking for Screen Recording

TCC stores an app's **designated requirement** when a permission is granted, and the signature
decides what that requirement is:

```
ad-hoc        designated => cdhash H"7c7f1a44..."
certificate   designated => identifier "com.capturo.app" and certificate leaf H"..."
```

An ad-hoc requirement is a hash of the app's own code. Any build that changes a byte produces a
different hash, so TCC treats it as a different app: the Screen Recording toggle stays visibly on
while the new build is denied and prompts again. This is why a rebuilt Capturo loses a permission
that Chrome keeps across updates — Chrome's requirement names its certificate, not its code. A
rebuild with no source change is harmless, because the build is deterministic and the hash is
unchanged; it is *changing* the app that invalidates the grant.

To stop it during development, sign with a stable certificate. One-time setup:

1. Open **Keychain Access → Certificate Assistant → Create a Certificate…**
2. Name it exactly `Capturo Local Signing`, Identity Type **Self Signed Root**, Certificate Type
   **Code Signing**, and create it in the **login** keychain.

`npm run dist:mac` picks it up automatically by name; `CAPTURO_MAC_SIGN_IDENTITY` overrides with
another certificate name or SHA-1 hash. Grants then survive every rebuild. Grant Screen Recording
once more after the first build signed this way, because the identity has changed for the last
time. The build prints the resulting requirement, so check it names a certificate rather than a
`cdhash`.

This is for local development only. A self-signed certificate is not trusted by Gatekeeper and
cannot be notarized, so it changes nothing about distribution.

Ad-hoc signing is not distribution. Two limits decide what a macOS release can claim, and both
are recorded in D-028:

- Gatekeeper refuses an ad-hoc signed app on any machine that downloads it. Distribution requires
  a Developer ID Application certificate, hardened runtime review, notarization, and stapling.
- TCC cannot hold a Screen Recording grant for an ad-hoc signature, which carries no Team ID and
  no designated requirement. Capturo appears in Screen & System Audio Recording and can be
  toggled on, but a freshly launched ad-hoc build still preflights as `denied` and captures
  nothing. Screen capture is the product, so **macOS is not releasable until a Developer ID
  certificate is available**, regardless of how much of the rest works.

Do not publish a macOS artifact to GitHub Releases before that certificate exists and a signed,
notarized build has captured, annotated, copied, and saved on real hardware. A macOS asset on a
stable release also has to be reconciled with the in-app update checker, which reads one
`releases/latest` feed for every platform.

When testing a macOS build, launch it with `open -a /Applications/Capturo.app`, not by executing
`Capturo.app/Contents/MacOS/Capturo` from a shell. TCC attributes a directly executed binary's
capture request to the parent terminal instead of to Capturo, which makes permission behavior
untestable and can appear to work when it will not for a real user.

## Release acceptance

- Artifact names are distinct and include version and architecture.
- Installed and portable launches are tested independently when both are intended for publication; otherwise the published target is stated consistently in the release notes and project documentation.
- Tray/menu-bar icon is correct at standard and high DPI.
- No capture data is written unless the user chooses Save or explicitly copies an unsaved GIF.
- Copy text uses the packaged local helper, requires no network, and reports missing/no-text cases without closing the editor.
- No unexpected network traffic or telemetry is introduced; the optional GitHub release check must match the documented privacy boundary.
- Documentation matches the released behavior and known constraints.
- `CHANGELOG.md` has an Unreleased/release entry, `PROJECT_STATE.md` reflects current work rather than a superseded target, and the documentation-routing checklist in `CONTRIBUTING.md` has been completed.
