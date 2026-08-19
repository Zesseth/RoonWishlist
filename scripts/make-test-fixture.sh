#!/usr/bin/env bash
# Build the small fake music library used by the testing guide.
#
# The files are empty: only their extensions matter, which is all the lossless
# detection looks at. Nothing here touches a real music library.
set -euo pipefail

FIXTURE="${1:-/var/tmp/roon-wishlist-fixture}"

rm -rf "$FIXTURE"
mkdir -p "$FIXTURE"

# make_album <location> <artist> <album> <extension>...
make_album() {
  local dir="$FIXTURE/$1/$2/$3"
  shift 3
  mkdir -p "$dir"
  local i=1
  for ext in "$@"; do
    printf '' > "$dir/$(printf '%02d' "$i") track.$ext"
    i=$((i + 1))
  done
}

make_album libA Opeth "Blackwater Park" flac flac flac flac flac
make_album libA Portishead "Dummy" mp3 mp3 mp3 mp3 mp3
make_album libA Tool "Lateralus" mp3 mp3 mp3 mp3 mp3 mp3 mp3 mp3 mp3 flac
make_album libA "Miles Davis" "Kind of Blue" wav wav wav
make_album libA "Nils Frahm" "Spaces" aiff aiff aiff
make_album libA Radiohead "In Rainbows" mp3 mp3 mp3
make_album libB "Pink Floyd" "Wish You Were Here" dsf dsf dsf
make_album libB Radiohead "In Rainbows" flac flac flac

# The service runs as its own user, so it has to be able to read this.
chmod -R a+rX "$FIXTURE"

echo "Fixture ready at $FIXTURE"
echo
echo "Set the library path in Settings to:"
echo "  $FIXTURE/libA; $FIXTURE/libB"
