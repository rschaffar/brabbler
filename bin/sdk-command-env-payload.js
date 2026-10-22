"use strict";
/* Generated from installed public SDK 1.3.0 dist bytes; no SDK source vendoring. */
module.exports = {
  "schemaVersion": 1,
  "patchId": "pi-desk-sdk-command-env-1.3.0-v2",
  "packageName": "@earendil-works/pi-coding-agent",
  "packageVersion": "1.3.0",
  "packageJsonSha256": "83c3bb7619f590c213cc96a24216eb29a819a3ef6dc548607cc037ed276e8dc5",
  "scope": "Twelve pinned modular SDK targets, including clipboard/browser helpers and RpcClient launch; excludes interactive-UI-only direct spawns, CLI/RPC bundles and arbitrary extension Node.js.",
  "helper": {
    "path": "dist/utils/pi-desk-command-env.js",
    "content": "/** Pi Desk child-command environment policy, pinned to SDK 1.3.0.\n * Install-time downstream patch; never imported from the application runtime.\n * This is hygiene, not an extension sandbox. Filter only the final child copy:\n * explicit empty environments stay empty, and SSH/account/session values survive.\n */\nexport function sdkCommandEnvironment(source = process.env, platform = process.platform) {\n    const environment = { ...source };\n    for (const key of Object.keys(environment)) {\n        const name = platform === \"win32\" ? key.toUpperCase() : key;\n        if (name === \"PI_WEB_PASSWORD\" || name === \"PI_DESK_SSH_RUNTIME\") delete environment[key];\n    }\n    return environment;\n}\n",
    "sha256": "70619385f02750445e93f7550bd8127c6ad6e3c6b03d066a340396cedac56ce3"
  },
  "files": [
    {
      "path": "dist/utils/child-process.js",
      "originalSha256": "cfc7b3361e42b61ee75aecc2b436ff7462f7e4431b4b646da7166f3c5706c9b8",
      "patchedSha256": "95d38e3e330662f18a597c9b01eb15a1257343df9efa62199325ac5f46627857",
      "replacements": [
        {
          "before": "import crossSpawn from \"cross-spawn\";\n",
          "after": "import crossSpawn from \"cross-spawn\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
        },
        {
          "before": "export function spawnProcess(command, args, options) {\n",
          "after": "export function spawnProcess(command, args, options) {\n    options = { ...options, env: sdkCommandEnvironment(options?.env ?? process.env) };\n"
        },
        {
          "before": "export function spawnProcessSync(command, args, options) {\n",
          "after": "export function spawnProcessSync(command, args, options) {\n    options = { ...options, env: sdkCommandEnvironment(options?.env ?? process.env) };\n"
        }
      ]
    },
    {
      "path": "dist/core/exec.js",
      "originalSha256": "6aed92abe5273445a9bddcd92d4178264d0a23890b54b175a0efc73b20cdf53f",
      "patchedSha256": "b05562837e5a192b9e779642617f89121f664e8384d073c6f49382cd2afd5ccf",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "            shell: false,\n",
          "after": "            shell: false,\n            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/core/resolve-config-value.js",
      "originalSha256": "01fdb1673990635bb419c7418eefa298b6a1c6fbb3c6193d3b05a4902e51992d",
      "patchedSha256": "e1f3b7239cf635482bf29e02acba90d69d7143fef13ef314a3ac47f688c22e30",
      "replacements": [
        {
          "before": "import { execSync, spawnSync } from \"child_process\";\n",
          "after": "import { execSync, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "        const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {\n",
          "after": "        const result = spawnSync(shell, commandFromStdin ? args : [...args, command], {\n            env: sdkCommandEnvironment(),\n"
        },
        {
          "before": "        const output = execSync(command, {\n",
          "after": "        const output = execSync(command, {\n            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/core/tools/bash.js",
      "originalSha256": "f32e87a42f66276b2eafaaf0848babf52523d37ab0fd448439586376747f03c4",
      "patchedSha256": "f6652d1baafe67dbcf156ea6b467a150a70458c4a845ed343cab61941493206d",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "                env: env ?? getShellEnv(),\n",
          "after": "                env: sdkCommandEnvironment(env ?? getShellEnv()),\n"
        }
      ]
    },
    {
      "path": "dist/core/tools/grep.js",
      "originalSha256": "641ae520a88c7eb86406d9a18880f31412cb41cdc15a7ee3e1da5de62979ca7c",
      "patchedSha256": "91253d4765c6f6b61aec3ee6fc64a8596aa038c71e7cdf3407a58875443975cd",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "const child = spawn(rgPath, args, { stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
          "after": "const child = spawn(rgPath, args, { env: sdkCommandEnvironment(), stdio: [\"ignore\", \"pipe\", \"pipe\"] });"
        }
      ]
    },
    {
      "path": "dist/core/tools/find.js",
      "originalSha256": "cbb5e3a76e962899f833452ff26670c1fdbf333e7efdecb9953b07f6ebd14ed7",
      "patchedSha256": "3263e09df80773d98647909a7c81a749c180a705ca4f844b8d952c25a59257a5",
      "replacements": [
        {
          "before": "import { spawn } from \"child_process\";\n",
          "after": "import { spawn } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "const child = spawn(fdPath, args, { stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
          "after": "const child = spawn(fdPath, args, { env: sdkCommandEnvironment(), stdio: [\"ignore\", \"pipe\", \"pipe\"] });"
        }
      ]
    },
    {
      "path": "dist/core/footer-data-provider.js",
      "originalSha256": "cb31fe6973228249ad0b02d4ec79509a1f7c7e63c2c15df35bb5d5100685f2ac",
      "patchedSha256": "3b8841edb7a097f5322658bdb524dfe233b17d690d459ef8a98eb7c7ccc9caf6",
      "replacements": [
        {
          "before": "import { execFile, spawnSync } from \"child_process\";\n",
          "after": "import { execFile, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "        cwd: repoDir,\n        encoding: \"utf8\",",
          "after": "        cwd: repoDir,\n        env: sdkCommandEnvironment(),\n        encoding: \"utf8\","
        },
        {
          "before": "            cwd: repoDir,\n            encoding: \"utf8\",",
          "after": "            cwd: repoDir,\n            env: sdkCommandEnvironment(),\n            encoding: \"utf8\","
        }
      ]
    },
    {
      "path": "dist/utils/shell.js",
      "originalSha256": "c8378f2b0566e35f90dfbb622a2214acf5cf45d15107c44b260cad897b539f72",
      "patchedSha256": "48e4fee457591f36f2ad7acafc98b1625bb2f1fd23f3d1e9487e7e506fbb33e8",
      "replacements": [
        {
          "before": "import { spawn, spawnSync } from \"child_process\";\n",
          "after": "import { spawn, spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
        },
        {
          "before": "            const result = spawnSync(\"where\", [executable], {\n",
          "after": "            const result = spawnSync(\"where\", [executable], {\n                env: sdkCommandEnvironment(),\n"
        },
        {
          "before": "spawnSync(\"which\", [executable], { encoding: \"utf-8\", timeout: 5000 })",
          "after": "spawnSync(\"which\", [executable], { env: sdkCommandEnvironment(), encoding: \"utf-8\", timeout: 5000 })"
        },
        {
          "before": "[\"/F\", \"/T\", \"/PID\", String(pid)], {\n",
          "after": "[\"/F\", \"/T\", \"/PID\", String(pid)], {\n                env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/utils/tools-manager.js",
      "originalSha256": "28e24a2022460ed4e17ac10d0766984b878c4f69eb6286efed9382b958eb2963",
      "patchedSha256": "120838540a6333572c359f1a08b95233c1716d7dd9499b803c109db5d48fd798",
      "replacements": [
        {
          "before": "import { spawnSync } from \"child_process\";\n",
          "after": "import { spawnSync } from \"child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
        },
        {
          "before": "spawnSync(cmd, [\"--version\"], { stdio: \"pipe\" })",
          "after": "spawnSync(cmd, [\"--version\"], { env: sdkCommandEnvironment(), stdio: \"pipe\" })"
        },
        {
          "before": "spawnSync(command, args, { stdio: \"pipe\" })",
          "after": "spawnSync(command, args, { env: sdkCommandEnvironment(), stdio: \"pipe\" })"
        }
      ]
    },
    {
      "path": "dist/utils/clipboard-command.js",
      "originalSha256": "d9933ef767ba69f2ff26017081b81094c86b827961f758055c7a44cdd2d876b2",
      "patchedSha256": "082f0ee2c6e2fff8c2be558f7048d39febd6793fc8890a2efe7f442f80abe5ed",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
        },
        {
          "before": "        const child = spawn(command, args, {\n",
          "after": "        const child = spawn(command, args, {\n            env: sdkCommandEnvironment(),\n"
        }
      ]
    },
    {
      "path": "dist/utils/open-browser.js",
      "originalSha256": "1268b4e07acbeff18bc8f7e4b39dbf19acd5be4f67f061fd5c17cac29646dfc2",
      "patchedSha256": "8808c63df0018be0a5c54c1d304252a86ed81c95deaed69248896c5b33ab84a1",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"./pi-desk-command-env.js\";\n"
        },
        {
          "before": "spawn(cmd, args, { stdio: \"ignore\", detached: true })",
          "after": "spawn(cmd, args, { env: sdkCommandEnvironment(), stdio: \"ignore\", detached: true })"
        }
      ]
    },
    {
      "path": "dist/modes/rpc/rpc-client.js",
      "originalSha256": "6cbb7d183db13468af61af733013a97ee6f5547ccd44edb1f85647f8bd6f218c",
      "patchedSha256": "e91587140b258baa554850b4061ec9c2538b0bf4fb04622ec592fa16d17d49fe",
      "replacements": [
        {
          "before": "import { spawn } from \"node:child_process\";\n",
          "after": "import { spawn } from \"node:child_process\";\nimport { sdkCommandEnvironment } from \"../../utils/pi-desk-command-env.js\";\n"
        },
        {
          "before": "            env: { ...process.env, ...this.options.env },\n",
          "after": "            env: sdkCommandEnvironment({ ...process.env, ...this.options.env }),\n"
        }
      ]
    }
  ]
};
