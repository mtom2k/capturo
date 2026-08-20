#!/bin/sh
# Builds the macOS text-recognition helper. Requires the Swift compiler, which comes with the
# Xcode Command Line Tools ("xcode-select --install"). No third-party dependency and no model
# data: Vision ships with macOS.
#
# Output: build/capturo-ocr, copied into the app by electron-builder.
#
# The helper is built universal by default so one binary serves an arm64, x64 or universal app
# and packaging never has to match slices to the Electron build. Override with, for example,
# CAPTURO_OCR_ARCHS="arm64" when a single-architecture helper is wanted.

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT="$DIR/build"
ARCHS=${CAPTURO_OCR_ARCHS:-"arm64 x86_64"}
# Matches LSMinimumSystemVersion in package.json. VNRecognizeTextRequest predates it well.
DEPLOYMENT_TARGET=12.0

if ! command -v swiftc >/dev/null 2>&1 && ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "ERROR: swiftc not found. Install the Xcode Command Line Tools with" >&2
  echo "       xcode-select --install, then run this again." >&2
  exit 1
fi

SWIFTC=$(command -v swiftc 2>/dev/null || xcrun --find swiftc)

mkdir -p "$OUT"

SLICES=""
for arch in $ARCHS; do
  slice="$OUT/capturo-ocr-$arch"
  # A failing slice stops the build. Quietly shipping a helper that is missing an architecture
  # would surface as "Copy text does nothing" on exactly the machines that were not tested.
  "$SWIFTC" -O \
    -target "$arch-apple-macos$DEPLOYMENT_TARGET" \
    -framework Vision -framework CoreGraphics -framework ImageIO \
    -o "$slice" "$DIR/main.swift"
  SLICES="$SLICES $slice"
done

# shellcheck disable=SC2086
if [ "$(echo $SLICES | wc -w)" -gt 1 ]; then
  lipo -create $SLICES -output "$OUT/capturo-ocr"
  rm -f $SLICES
else
  mv $SLICES "$OUT/capturo-ocr"
fi

echo "Built $OUT/capturo-ocr ($(lipo -archs "$OUT/capturo-ocr"))"
