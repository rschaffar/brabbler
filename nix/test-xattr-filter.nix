{ pkgs }:
pkgs.runCommandCC "brabbler-test-xattr-filter" { } ''
  mkdir -p "$out/bin"
  "$CC" -std=c11 -O2 -Wall -Wextra -Werror \
    ${./test-xattr-filter.c} -o "$out/bin/brabbler-test-deny-xattrs"
''
