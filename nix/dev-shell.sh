# Sourced by the Nix development shell. Next/Turbopack will not resolve
# packages whose real paths escape its workspace, so the nixpkgs linker hook
# cannot be used here. Materialize a checkout-local copy of Nix-built modules.
brabbler_prepare_modules() {
  local source_modules="$1" root target stage current
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root=$PWD
  target="$root/node_modules"
  if [ ! -f "$root/package-lock.json" ] || ! cmp -s "$root/package-lock.json" @lockFile@; then
    echo "Brabbler Nix shell: enter from a checkout matching this flake's package-lock.json." >&2
    return 1
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ -L "$target" ] || [ ! -d "$target" ] || [ ! -f "$target/.brabbler-nix-module-source" ]; then
      echo "Brabbler Nix shell: $target is not a Nix-managed directory; move it aside explicitly first." >&2
      return 1
    fi
    IFS= read -r current < "$target/.brabbler-nix-module-source"
    if [ "$current" != "$source_modules" ] || [ ! -f "$target/next/package.json" ]; then
      echo "Brabbler Nix shell: dependencies changed; move the old $target aside before re-entering." >&2
      return 1
    fi
  else
    stage=$(mktemp -d "$root/.brabbler-node-modules.XXXXXXXX") || return 1
    # Reflinks avoid a full copy when the store and checkout share a CoW FS;
    # otherwise this is a one-time copy per worktree and lock revision.
    if ! cp -a --no-preserve=ownership --reflink=auto "$source_modules/." "$stage/"; then
      echo "Brabbler Nix shell: dependency copy failed; inspect $stage before retrying." >&2
      return 1
    fi
    # cp -a preserves store permissions. Make the *copy* writable so npm
    # tools and local caches work normally and the checkout can be cleaned up.
    if ! chmod -R u+w "$stage" || ! printf '%s\n' "$source_modules" > "$stage/.brabbler-nix-module-source"; then
      echo "Brabbler Nix shell: cannot mark the staged copy; inspect $stage." >&2
      return 1
    fi
    if [ -e "$target" ] || [ -L "$target" ] || ! mv -T "$stage" "$target"; then
      echo "Brabbler Nix shell: node_modules changed while preparing; staged copy remains at $stage." >&2
      return 1
    fi
  fi
  export PATH="$target/.bin:$PATH"
}

if ! brabbler_prepare_modules "@sourceModules@"; then
  unset -f brabbler_prepare_modules
  return 1
fi
unset -f brabbler_prepare_modules
