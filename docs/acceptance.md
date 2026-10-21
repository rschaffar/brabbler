# Shared project acceptance

The **Acceptance** toolbar button opens the selected checkout's project queue, even without an open conversation. Pi Web owns configured jobs independently of chats. Closing the panel, navigating, session Stop/Pause or cancelling a status wait does **not** cancel an already-admitted job. Use **Cancel acceptance run** explicitly.

## Configure a project

Expand **Configure project profiles**, edit the JSON array and choose **Save profiles**. Configuration is private under the active agent directory's `pi-web/acceptance/settings.json`, not executable configuration discovered from a repository. Tools cannot configure profiles or their own permissions. Nothing is configured or launched automatically merely by opening a project.

Each profile has exactly these fields:

```json
[
  {
    "name": "focused",
    "label": "Project unit checks",
    "coverage": "focused",
    "argv": ["node", "test.mjs"],
    "inputs": ["src", "test.mjs"],
    "cpus": 2,
    "memoryMiB": 2048,
    "permission": "ask"
  }
]
```

- `argv` is an argument vector, not a shell command. Programs run in the captured source directory. Use `PI_WEB_ACCEPTANCE_RUNTIME` for writable output and caches, not source-relative build output. Profiles execute trusted code as the Pi Web OS user: this coordinator is **not** an OS sandbox. Choose a sandboxed project runner where required.
- `inputs` are existing literal relative file/directory roots. Nested roots cannot overlap. Included trees admit new source files too. Symlinks, special files, cross-device entries, unsafe names and privileged modes refuse. Dot/private/generated/credential names and secret-key/log suffixes are excluded; `.github`, `.gitignore` and the exact maintained `.agents/skills/writing-plans` subtree are deliberate exceptions. Exclusion is not a secret-content detector. Review every declared tree before capture; code/docs can contain sensitive content too.
- `coverage` is a **profile declaration**, not independent verification. `full` means the configured runner is responsible for complete acceptance and its evidence. A zero exit status does not make an arbitrary command prove browser, deployment or host permission checks.
- `cpus` / `memoryMiB` are conservative admission estimates. The coordinator also requires 1 GiB memory headroom, respects observed CPU affinity/cgroup CPU and memory headroom, and never increases test deadlines. It does not impose cgroups or resize a running job.
- `permission` is `ask`, `allow` or `deny` for model requests. Ask shows the exact recipe, inputs and budget; Allow removes that prompt, not applicable user/repository instructions. Browser **Run** is its own explicit request. Deny refuses both paths. An agent must never alter configuration to authorize itself.

**Use Pi Web Nix template** fills, but does not save or execute, this repository's complete fresh `nix run --no-write-lock-file .#test -- all --workers 4 --jobs 4` profile. Other repositories need their own declared inputs and runner. Production builds remain inside isolated Nix builders; no installed host service is used. The template does not widen the current runner's worker limits.

Initial execution is Linux-only. The minimal environment is versioned and captured with the request: frozen PATH, `LANG=C.UTF-8`, `NODE_ENV=test`, and private HOME/XDG/TMP/agent directories. Host passwords, provider accounts, proxies, SSH agents, Node/QEMU options and arbitrary ambient environment variables are not forwarded. PATH/argv are frozen values, not a guarantee that arbitrary non-pinned executables or their transitive toolchains cannot change. A pinned runner must establish its toolchain evidence.

## Session tools

Ordinary coding sessions and extension-enabled subagents receive:

- `acceptance_run({profile, cwd?, requestId?})`: capture/verify source, join an identical eligible in-flight request or enqueue a new run, and return its ID. The optional checkout must belong to the session's own physically verified project. Reuse the exact request ID after an uncertain response; a retry returns its original run, even if source subsequently changed, and refuses a changed recipe/project. A new request is needed to test new source. A different tool-call ID without an explicit retry key is a new request.
- `acceptance_status({cwd?, runId?, wait?})`: list profiles/recent runs, or inspect one run with a bounded log tail. `wait` lasts at most 30 seconds and does not start a model turn on completion. Collect the run again if it is still queued/running. Cancelling this wait leaves the job alone.
- `acceptance_cancel({runId, cwd?})`: explicitly cancel a run initiated by that exact SDK session. Joining, copying/forking history or reading a run does not grant cancellation authority. The authenticated browser panel can explicitly cancel any selected-project run.

Chat-only sessions and subagents whose extension/resource rules omit these tools remain unchanged. Existing live sessions need recreation/reload to load new host tools. No fresh ordinary sessions or subagents are spawned by acceptance itself.

## Queue and input identity

One coordinator owns one heavy execution slot across **all projects using this Pi Web agent directory**. Resource-sufficient jobs dispatch FIFO; an insufficient head job remains queued rather than silently receiving fewer workers. Other Pi Web instances using different agent directories, terminals and shell-launched commands are outside this cooperative budget.

Registered linked worktrees share a physical common-Git-directory identity (including replacement identity where available); plain directories are individually scoped. Project grouping alone never grants path access or trust, and sidebar metadata is not admission authority.

Before queueing, the coordinator copies and verifies the explicit inputs twice using descriptor-relative Linux traversal. Pause source writers during capture. It records file bytes, executable bits and sealed copy modes, refuses detected changes, and verifies the frozen copy before and after execution. Capture is not a filesystem transaction against hostile external writers; read-only modes are not sandbox containment against same-user trusted programs.

In-flight sharing requires the same project, source content/mode digest, frozen profile, execution platform/architecture and environment recipe. Different worktree contents queue separately. Historical passes are never automatically substituted for a new fresh request. A new commit ID alone is not the source identity; conversely, identical HEADs do not imply identical dirty/untracked inputs. Source-only snapshots exclude Git metadata, so profiles needing `.git` must use another verification workflow rather than assume current-checkout Git data is available.

Source SHA-256, original cwd, profile, interested callers, capture/queue/execution timing and full log path are retained per run. Aggregate output retains up to 16 MiB; exceeding that bound stops the job and retains the original prefix. The browser/tool shows a 32 KiB tail. The configured runner must publish its own preparation/test-execution intervals and exact coverage/sandbox evidence in that output or retained artifacts; the coordinator does not infer these from arbitrary log text.

## Cancellation, restart and recovery

`Cancelling` means a request to stop, not proof of settlement. The Linux supervisor authenticates child generations, owns the original process group/pipes and samples descendants. It escalates only authenticated owned processes. These bounded observations do **not** certify unobserved/escaped descendants. The configured Nix runner retains its stronger builder containment and evidence contracts.

Admission/result writes are private, atomic and directory-synced. Ownership survives module/HMR reload. A second server cannot steal an existing owner. After a process restart, unfinished saved jobs project as **Outcome / settlement unknown**; they are not replayed, adopted or killed by saved PID. New heavy work is blocked. The browser's recovery checkbox requires the user to verify that previous processes/sandboxes have stopped across the whole agent directory. Reconciliation records an unknown/reconciled outcome, never a fabricated test pass, and refuses while another authenticated coordinator remains alive. A live supervisor whose completed result write failed retains that result; recovery retries only its durable write, never execution or old approval. Pre-dispatch persistence failures retain known never-started admissions; explicit recovery cancels these rather than stranding or replaying them. A kernel `flock` serializes recovery and releases on owner exit; no stale-heartbeat takeover or unowned lock-directory deletion is used. Linux installations need `flock` on the service PATH (included by the Nix package).

Snapshots, runtime files, original logs and failed/duplicate capture directories are retained; there is no automatic cleanup or age-based reaper. The private history admits at most 1,000 runs, 32 pending runs, 256 request references per shared run, and a 12 MiB admission budget with completion reserve below the 16 MiB read/write limit. Configuration is bounded separately. Reaching a bound refuses new work without discarding evidence. The retained `recovery.flock` file is a kernel-lock anchor, not executable authority; its mere presence does not block a subsequent recovery after the previous lock owner has exited.

## Verification

`lib/acceptance/` owns profile/snapshot, scheduler, supervisor, tool and API regressions. The existing Activity packaged-browser chain exercises configuration, in-flight sharing, FIFO queueing, retained status after reload, logs, explicit cancellation, keyboard focus and narrow layout with synthetic jobs. It never recursively launches real acceptance. Follow [Testing](testing.md) for the unchanged complete core/browser/deployment requirements.
