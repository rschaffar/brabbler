{
  description = "Pi Web package and local development tools";

  # Keep the local browser close to the Chromium revision pinned by Playwright.
  # Update this with the npm Playwright version, not implicitly with a channel.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/44a91898084f46797b5fac650c7e8c9ac38c43d4";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      linuxSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystems =
        selected: f: nixpkgs.lib.genAttrs selected (system: f (import nixpkgs { inherit system; }));
    in
    {
      packages = forSystems systems (pkgs: rec {
        pi-web = pkgs.callPackage ./nix/package.nix { src = self; };
        default = pi-web;
      });

      # Nix-wrapped Chromium avoids Playwright's downloaded binary missing
      # shared libraries on NixOS. CI and non-NixOS users keep their own browser.
      devShells = forSystems linuxSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.git
            pkgs.chromium
          ];
          PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
        };
      });
    };
}
