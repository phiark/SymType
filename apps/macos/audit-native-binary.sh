#!/bin/zsh

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  print -u2 "usage: zsh apps/macos/audit-native-binary.sh /path/to/SymType"
  exit 64
fi

binary_path="$1"
if [[ ! -f "$binary_path" ]]; then
  print -u2 "native binary does not exist: $binary_path"
  exit 66
fi

architectures="$(/usr/bin/lipo -archs "$binary_path")"
if [[ "$architectures" != "arm64" ]]; then
  print -u2 "expected an arm64-only binary, found: $architectures"
  exit 1
fi

minimum_version="$(
  /usr/bin/otool -l "$binary_path" |
    /usr/bin/awk '
      $1 == "cmd" && $2 == "LC_BUILD_VERSION" { in_build_version = 1; next }
      in_build_version && $1 == "minos" { print $2; exit }
    '
)"
if [[ "$minimum_version" != "15.0" ]]; then
  print -u2 "expected LC_BUILD_VERSION minos 15.0, found: ${minimum_version:-missing}"
  exit 1
fi

print "native binary audit passed: arm64, minimum macOS 15.0"
