"""One real Home Manager deployment; no browser inventory or browser support."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import time
import traceback
from types import TracebackType
from typing import Any

support = "@support@"
node = "@node@"
registry_file = "@registry@"
registry: dict[str, Any] = json.loads(Path(registry_file).read_text())
plan: dict[str, Any] = json.loads(subprocess.check_output(
    [node, f"{support}/service-plan.mjs", "plan", registry_file], text=True, timeout=10))
service = registry["service"]
(driver.out_dir / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
checks = [{"name": name, "status": "not-run"} for name in plan["checks"]]
proof: dict[str, Any] = {name: None for name in ("activation", "permissions", "write", "restart", "pty")}
errors: list[str] = []
known_groups: set[str] = set()
clients_settled = True
acceptance_ready = diagnostic_reachable = probe_passed = collected = False
collecting = False
settlement: dict[str, Any] = {"status": None, "groups": [], "port": None}
artifacts: dict[str, str] = {}
primary: BaseException | None = None
primary_traceback: TracebackType | None = None
validation: subprocess.CompletedProcess[str] | None = None
core_stage = "/var/lib/brabbler-evidence"
helper_stage = "/var/lib/brabbler-helper-evidence"
probe_stage = "/var/lib/brabbler-evidence-probe"
started = time.monotonic()


def require_existing_channel():
    # execute/connect can implicitly start a VM. Collection may use only the
    # already-connected guest, never start/reconnect/reboot it after a failure.
    if collecting:
        assert machine.is_up(), "Existing guest diagnostic channel unavailable; refusing reconnect"


def command(argv, timeout=120):
    require_existing_channel()
    return machine.succeed(shlex.join(argv), timeout=timeout)


def control(action):
    return command(["runuser", "-u", service["user"], "--", service["controller"], action])


def properties():
    return dict(line.split("=", 1) for line in control("status").strip().splitlines())


def service_cgroup(group):
    assert isinstance(group, str) and re.fullmatch(
        r"/user\.slice/user-1000\.slice/user@1000\.service/(?:[A-Za-z0-9_.@:-]+/)*brabbler\.service", group
    ) and not any(part in (".", "..") for part in group.split("/")), f"Foreign cgroup: {group}"
    return group


def observe_cgroup(group):
    service_cgroup(group)
    # Only ENOENT is absence; unreadable/malformed/populated observations fail.
    script = """const fs = require('node:fs');
try { process.stdout.write(fs.readFileSync('/sys/fs/cgroup' + process.argv[1] + '/cgroup.events', 'utf8')); }
catch (error) { if (error.code === 'ENOENT') console.log('absent'); else throw error; }"""
    output = command([node, "-e", script, group], timeout=10).strip()
    if output == "absent":
        return "absent"
    assert re.findall(r"^populated ([01])$", output, re.M) == ["0"], f"Cgroup not established empty: {output}"
    return "empty"


def live(expected=None):
    current = properties()
    assert current["ActiveState"] == "active" and current["SubState"] == "running"
    assert re.fullmatch(r"[1-9][0-9]*", current["MainPID"])
    assert re.fullmatch(r"[a-f0-9]{32}", current["InvocationID"])
    assert current["NRestarts"] == "0" and current["Result"] == "success"
    known_groups.add(service_cgroup(current["ControlGroup"]))
    generation = {key: current[key] for key in (
        "ActiveState", "SubState", "InvocationID", "MainPID", "NRestarts", "ControlGroup", "Result"
    )}
    if expected is not None:
        assert generation == expected, "Service changed generation/PID/restarts/cgroup unexpectedly"
    return generation


def smoke(mode, *extra):
    global clients_settled
    prior = clients_settled
    clients_settled = False
    argv = ["runuser", "-u", service["user"], "--", "env", "-i", f"HOME={service['home']}",
            "PATH=/run/current-system/sw/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8",
            node, f"{support}/service-smoke.mjs", mode, registry_file, *extra]
    code, output = machine.execute(shlex.join(argv) + " 2>&1", timeout=40)
    # The synchronous runuser/Node client exited, even if its assertions failed.
    # An earlier uncertain client cannot be cleared by a later successful call.
    clients_settled = prior
    assert code == 0, f"{mode} helper failed ({code}): {output}"
    return json.loads(output)


def check(name, action):
    record = next(item for item in checks if item["name"] == name)
    record["status"] = "failed"
    with subtest(name):
        result = action()
    record["status"] = "passed"
    return result


def guest_tree_manifest(source, names=()):
    """Validate the SAME strict tree guard, then hash only root-owned staging."""
    assert source in (core_stage, helper_stage, probe_stage), "Foreign evidence source"
    assert not names or (source == core_stage and list(names) == plan["artifacts"])
    script = (
        "import assert from 'node:assert/strict';\n"
        "import fs from 'node:fs';\n"
        "import { createHash } from 'node:crypto';\n"
        f"import {{ assertEvidenceTree }} from {json.dumps(f'{support}/vm-evidence.mjs')};\n"
        """const root = process.argv[1], names = JSON.parse(process.argv[2]);
assert.equal(process.getuid(), 0);
assert.equal(fs.readFileSync('/etc/brabbler-acceptance-guest', 'utf8').trim(), 'brabbler-nixos-acceptance-v1');
const initial = fs.lstatSync(root);
assert.ok(initial.isDirectory() && initial.uid === 0 && (initial.mode & 0o777) === 0o700, 'Root-private evidence staging required');
assertEvidenceTree(root); // Physical root, entry bound, symlinks, devices and special files.
const digests = {}, missing = [], buffer = Buffer.alloc(64 * 1024);
for (const name of names) {
  let fd;
  try { fd = fs.openSync(root + '/' + name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') { missing.push(name); continue; } throw error; }
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === 0 && stat.nlink === 1, 'Physical root-owned single-link artifact required');
    const hash = createHash('sha256');
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
    digests[name] = hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
console.log(JSON.stringify({digests, missing}));"""
    )
    require_existing_channel()
    code, output = machine.execute(shlex.join(
        [node, "--input-type=module", "-e", script, source, json.dumps(list(names))]) + " 2>&1", timeout=30)
    if code != 0:
        raise ValueError(f"Unsafe evidence export refused: {output}")
    result: dict[str, Any] = json.loads(output)
    assert set(result) == {"digests", "missing"}
    assert set(result["digests"]).union(result["missing"]) == set(names)
    assert not set(result["digests"]).intersection(result["missing"])
    assert all(re.fullmatch(r"[a-f0-9]{64}", value) for value in result["digests"].values())
    return result


def copy_evidence(source, destination):
    # The pinned driver's HOST copytree dereferences links. Validate immediately
    # before that operation, never copying an unsafe helper tree to salvage it.
    guest_tree_manifest(source)
    require_existing_channel()
    machine.copy_from_machine(source, destination)


def verify_exported_artifacts(root, expected, mandatory):
    """Compare transfer results with GUEST hashes; never derive receipt hashes here."""
    assert root.resolve(strict=True) == root and root.is_dir(), "Physical exported root required"
    assert set(expected).issubset(mandatory), "Foreign artifact digest"
    for filename, guest_digest in expected.items():
        assert re.fullmatch(r"[a-f0-9]{64}", guest_digest)
        fd = os.open(root / filename, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            assert stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, f"Unsafe exported artifact: {filename}"
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        assert digest.hexdigest() == guest_digest, f"Guest/host artifact hash mismatch: {filename}"
    assert set(expected) == set(mandatory), "Missing mandatory guest artifact digests"


def diagnostic_channel_reachable():
    # is_up() here means booted AND connected, not that multi-user.target passed.
    # Do not call execute when it could implicitly start/connect a different boot.
    if not machine.is_up():
        return False
    try:
        code, output = machine.execute("printf %s brabbler-diagnostic-channel-v1", timeout=10)
        return code == 0 and output == "brabbler-diagnostic-channel-v1"
    except Exception as error:
        errors.append(f"Diagnostic channel probe: {error}")
        traceback.print_exc()
        return False


def collect_helper_evidence():
    # A separate ROOT-private sibling: cp -a may preserve user-owned directories
    # and unsafe links, but cannot poison the core journal/observations tree.
    try:
        command(["install", "-d", "-m", "700", "-o", "root", "-g", "root", helper_stage, f"{helper_stage}/artifacts"])
        command(["cp", "-a", f"{service['evidence']}/.", f"{helper_stage}/artifacts/"])
        copy_evidence(helper_stage, "guest-helpers")
        return True
    except Exception as error:
        errors.append(f"Helper evidence incomplete/unsafe: {error}")
        traceback.print_exc()
        return False


def collect_core_evidence(helper_collected):
    global artifacts
    try:
        command(["install", "-d", "-m", "700", "-o", "root", "-g", "root", core_stage])
        collection_failed = False
        try:
            command(["tar", "-czf", f"{core_stage}/fixtures.tar.gz", "-C", service["home"], "fixtures", "service.env"], timeout=30)
        except Exception as error:
            collection_failed = True
            errors.append(f"Fixture archive: {error}")
            traceback.print_exc()
        # Archive/helper failures never suppress safe journal attempts.
        for filename, argv in (
            ("journal.log", ["journalctl", "-b", "--no-pager", "-o", "short-iso"]),
            ("service.log", ["journalctl", "-b", "--no-pager", "-o", "short-iso", "_SYSTEMD_USER_UNIT=brabbler.service", "_UID=1000"]),
        ):
            try:
                require_existing_channel()
                machine.succeed(shlex.join(argv) + " > " + shlex.quote(f"{core_stage}/{filename}"), timeout=30)
            except Exception as error:
                collection_failed = True
                errors.append(f"{filename}: {error}")
                traceback.print_exc()
        observations = {"plan": plan, "checks": checks, "proof": proof, "clientsSettled": clients_settled,
                        "acceptanceReady": acceptance_ready, "diagnosticReachable": diagnostic_reachable,
                        "helpersCollected": helper_collected, "settlement": settlement, "errors": errors}
        try:
            command([node, "-e", "require('node:fs').writeFileSync(process.argv[1], process.argv[2], {flag: 'wx', mode: 0o600})",
                     f"{core_stage}/observations.json", json.dumps(observations, indent=2) + "\n"])
        except Exception as error:
            collection_failed = True
            errors.append(f"Observations: {error}")
            traceback.print_exc()
        # This is authoritative: the tree is validated and hashed INSIDE the
        # root-private guest stage BEFORE copy_from_machine and its shared hop.
        manifest = guest_tree_manifest(core_stage, plan["artifacts"])
        artifacts = dict(manifest["digests"])
        if manifest["missing"]:
            collection_failed = True
            errors.append(f"Missing staged artifacts: {manifest['missing']}")
        # Even an incomplete archive must not suppress export of safe journals.
        copy_evidence(core_stage, "guest")
        exported = driver.out_dir / "guest" / "brabbler-evidence"
        verify_exported_artifacts(exported, artifacts, plan["artifacts"])
        return not collection_failed and helper_collected
    except Exception as error:
        errors.append(f"Core evidence collection: {error}")
        traceback.print_exc()
        return False


def activation():
    machine.wait_for_unit("home-manager-t0.service", timeout=120)
    smoke("seed")
    generated = smoke("activation")
    code, output = machine.execute("systemctl is-active user@1000.service")
    assert code != 0 and output.strip() == "inactive", "User manager started before the default-target proof"
    # Never explicitly start the application or manufacture its startup link.
    command(["systemctl", "start", "user@1000.service"])
    machine.wait_for_unit("brabbler.service", user=service["user"], timeout=120)
    machine.wait_for_open_port(service["port"], timeout=120)
    observed = properties()
    assert observed["UMask"] == "0077" and observed["WorkingDirectory"] == service["home"]
    assert registry["launcher"] in observed["ExecStart"]
    fragment = command(["readlink", "-f", observed["FragmentPath"]]).strip()
    assert fragment == generated["target"]
    return {**generated, "fragment": fragment, "managerWasInactive": True, "generation": live()}


def permissions():
    generation = proof["activation"]["generation"]
    live(generation)
    observed = smoke("permissions", generation["MainPID"])
    denied = {}
    for name, file in (("environment", service["envFile"]), ("session", plan["session"]["file"])):
        # Distinguish genuine EACCES from a missing fixture or broken probe user.
        script = """const fs = require('node:fs');
if (process.getuid() !== 65534) throw new Error('Expected nobody probe');
try { fs.readFileSync(process.argv[1]); throw new Error('Private file was readable'); }
catch (error) { if (error.code !== 'EACCES') throw error; }"""
        command(["runuser", "-u", "nobody", "--", node, "-e", script, file], timeout=10)
        denied[name] = True
    live(generation)
    return {**observed, "deniedReads": denied}


def http_write():
    generation = proof["activation"]["generation"]
    live(generation)
    result = smoke("http-write")
    live(generation)
    return result


def restart():
    before = live(proof["activation"]["generation"])
    control("restart")
    machine.wait_for_unit("brabbler.service", user=service["user"], timeout=120)
    machine.wait_for_open_port(service["port"], timeout=120)
    after = live()
    assert after["InvocationID"] != before["InvocationID"], "Explicit restart did not change invocation"
    session = smoke("restart-read")
    assert session == proof["write"]["session"], "Durable session/name changed across restart"
    live(after)
    return {"before": before, "after": after, "session": session}


def pty():
    generation = proof["restart"]["after"]
    live(generation)
    result = smoke("pty", generation["ControlGroup"])
    live(generation)
    return result  # No DELETE: final unit stop must settle this live native shell.


try:
    start_all()
    machine.wait_for_unit("multi-user.target", timeout=120)
    acceptance_ready = True
    with subtest("evidence-symlink-boundary"):
        host_sentinel = driver.out_dir.parent / "host-only-evidence-sentinel"
        with host_sentinel.open("x") as sentinel:
            sentinel.write("Synthetic host-only evidence boundary fixture\n")
        command(["mkdir", "-m", "700", probe_stage])
        command(["ln", "-s", str(host_sentinel), f"{probe_stage}/host-link"])
        try:
            copy_evidence(probe_stage, "symlink-probe")
        except ValueError as error:
            assert "symbolic link" in str(error), error
        else:
            raise AssertionError("Guest link crossed the host evidence boundary")
        assert not (driver.out_dir / "symlink-probe").exists()
        probe_passed = True
    proof["activation"] = check("activation", activation)
    proof["permissions"] = check("environment-permissions", permissions)
    proof["write"] = check("http-write", http_write)
    proof["restart"] = check("restart-persistence", restart)
    proof["pty"] = check("production-pty", pty)
except Exception as error:
    primary, primary_traceback = error, error.__traceback__
    errors.append(str(error) or type(error).__name__)
    traceback.print_exc()
finally:
    collecting = True
    diagnostic_reachable = diagnostic_channel_reachable()
    if diagnostic_reachable:
        try:
            current = properties()
            if current.get("ControlGroup"):
                known_groups.add(service_cgroup(current["ControlGroup"]))
            if all(item["status"] == "passed" for item in checks):
                live(proof["restart"]["after"])
        except Exception as error:
            errors.append(f"Pre-stop observation: {error}")
        try:
            control("stop")
            settlement["status"] = properties()
            settlement["groups"] = [{"path": group, "state": observe_cgroup(group)} for group in sorted(known_groups)]
            assert known_groups, "No authenticated service cgroup was observed"
            assert settlement["status"]["ActiveState"] == "inactive" and settlement["status"]["MainPID"] == "0"
            command([node, f"{support}/vm-evidence.mjs", "port", str(service["port"])], timeout=10)
            settlement["port"] = "refused"
        except Exception as error:
            errors.append(f"Service settlement: {error}")
            traceback.print_exc()
        helper_collected = collect_helper_evidence()
        collected = collect_core_evidence(helper_collected)
    else:
        errors.append("Guest diagnostic channel unreachable; no reconnect or new boot attempted")
    receipt = {"version": 1, "kind": "brabbler-service-evidence", "plan": plan,
               "passed": acceptance_ready and not errors and all(item["status"] == "passed" for item in checks),
               "checks": checks, "proof": proof, "clientsSettled": clients_settled, "settlement": settlement,
               "collectionProbe": probe_passed, "artifactsCollected": collected, "artifacts": artifacts,
               "errors": errors, "elapsedSeconds": round(time.monotonic() - started, 3)}
    receipt_file = driver.out_dir / "acceptance.json"
    receipt_file.write_text(json.dumps(receipt, indent=2) + "\n")
    try:
        validation = subprocess.run([node, f"{support}/service-plan.mjs", "receipt"],
                                    input=json.dumps({"plan": plan, "receipt": receipt}), text=True, capture_output=True, timeout=10)
        if validation.returncode != 0:
            print(validation.stderr, flush=True)
    except Exception as error:
        receipt["passed"] = False
        errors.append(f"Evidence validation: {error}")
        receipt_file.write_text(json.dumps(receipt, indent=2) + "\n")
        traceback.print_exc()
if primary is not None:
    raise primary.with_traceback(primary_traceback)
assert validation is not None and validation.returncode == 0, "Missing/unsafe service evidence or uncertain settlement; retain VM bulk"
assert receipt["passed"], "Deployment assertions/collection/settlement failed; original diagnostics retained"
