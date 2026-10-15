"""One guest/package; deterministic concurrent lanes with independent HM units."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import time
import traceback
from typing import Any

support = "@support@"
registry = json.loads(Path("@registry@").read_text())
focus = os.environ.get("PI_WEB_E2E_GROUP", "all")
plan = json.loads(subprocess.check_output(["@node@", f"{support}/nix/vm-plan.mjs", "plan", "@registry@", focus], text=True))
(driver.out_dir / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
records: dict[str, dict[str, Any]] = {job["name"]: {"name": job["name"], "lane": job["lane"], "status": "not-run", "runnerSettled": True} for job in plan["jobs"]}
lanes = {lane["id"]: lane for lane in plan["lanes"]}
state = {lane["id"]: {"id": lane["id"], "smoke": False, "restart": None, "collected": False,
                           "serviceStopped": False, "runnersStopped": False} for lane in plan["lanes"]}
passed = guest_ready = probe_passed = False
started = time.monotonic()


def command(argv):
    return machine.succeed(shlex.join(argv))


def control(lane, action):
    return command(["runuser", "-u", lane["user"], "--", lane["controller"], action])


def properties(unit):
    output = command(["systemctl", "show", unit, "-p", "ActiveState,SubState,InvocationID,MainPID,ControlGroup,Result,ExecMainStatus"])
    return dict(line.split("=", 1) for line in output.strip().splitlines())


def empty_cgroup(group, prefix):
    assert group.startswith(prefix) and ".." not in group.split("/"), f"Foreign cgroup: {group}"
    file = f"/sys/fs/cgroup{group}/cgroup.events"
    output = command(["@shell@", "-c", f"if test -e {shlex.quote(file)}; then cat {shlex.quote(file)}; else echo absent; fi"])
    return output.strip() == "absent" or "populated 0" in output.splitlines()


def copy_evidence(source, destination):
    # copy_from_machine's HOST copytree dereferences links. Validate the settled,
    # root-private staging tree in the GUEST before invoking that host operation.
    code, output = machine.execute(shlex.join(["@node@", f"{support}/nix/vm-evidence.mjs", "tree", source]) + " 2>&1", timeout=30)
    if code != 0:
        raise ValueError(f"Unsafe evidence export refused: {output}")
    machine.copy_from_machine(source, destination)


def port_closed(lane):
    machine.succeed(shlex.join(["@node@", f"{support}/nix/vm-evidence.mjs", "port", str(lane["port"])]), timeout=10)


def live(lane, expected=None):
    current = dict(line.split("=", 1) for line in control(lane, "status").strip().splitlines())
    assert current["ActiveState"] == "active" and current["SubState"] == "running"
    assert current["MainPID"] != "0" and current["NRestarts"] == "0" and len(current["InvocationID"]) == 32
    assert current["ControlGroup"].startswith(f"/user.slice/user-{lane['uid']}.slice/user@{lane['uid']}.service/")
    if expected:
        for key in ("InvocationID", "MainPID", "ControlGroup", "NRestarts"):
            assert current[key] == expected[key], f"Service changed {key}"
    state[lane["id"]]["cgroup"] = current["ControlGroup"]
    return current


def validate(mode, data):
    result = subprocess.run(["@node@", f"{support}/nix/vm-plan.mjs", mode], input=json.dumps(data), text=True, capture_output=True)
    assert result.returncode == 0, result.stderr


def stop_runner(job):
    record = records[job["name"]]
    if record["status"] == "not-run":
        return True
    # A successfully stopped transient unit can already have been unloaded.
    # Reobserve its exact cgroup instead of treating a second stop's unknown-unit
    # error as uncertainty. This driver creates each unique unit only once.
    if record["runnerSettled"]:
        return empty_cgroup(f"/system.slice/{job['unit']}", f"/system.slice/{job['unit']}")
    # Stop the complete runner cgroup before the final application stop,
    # preventing a late acquisition. Never discover/signal numeric PIDs.
    command(["systemctl", "stop", job["unit"]])
    group = record["runner"].get("ControlGroup") or f"/system.slice/{job['unit']}"
    result = properties(job["unit"])
    return result["MainPID"] == "0" and result["ActiveState"] in ("inactive", "failed") and empty_cgroup(group, f"/system.slice/{job['unit']}")


def launch(job):
    lane = lanes[job["lane"]]
    command(["install", "-d", "-m", "700", "-o", lane["user"], "-g", "users", job["fixture"], job["evidence"]])
    env = {"PATH": "/run/current-system/sw/bin", "HOME": lane["home"], "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
           "SHELL": "@shell@", "E2E_PACKAGE_ROOT": plan["package"], "E2E_BASE_URL": f"http://127.0.0.1:{lane['port']}",
           "E2E_SERVICE_CONTROL": lane["controller"], "E2E_SERVICE_ENV": lane["envFile"],
           "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH": "@chromium@", "PI_WEB_TEST_FIXTURES": job["fixture"],
           "PI_WEB_TEST_ARTIFACTS": job["evidence"], "PI_WEB_TEST_TMP": f"{job['fixture']}/tmp"}
    if job["selector"]:
        env[job["selector"]] = "1"
    record = records[job["name"]]
    record.update(status="failed", runnerSettled=False, startedAt=time.monotonic(), startedSeconds=round(time.monotonic() - started, 3))
    argv = ["systemd-run", f"--unit={job['unit']}", "--property=Type=exec", "--property=RemainAfterExit=yes",
            f"--property=User={lane['user']}", "--property=Group=users", f"--property=WorkingDirectory={lane['home']}",
            "--property=UMask=0077", "--property=KillMode=control-group", "--property=TimeoutStopSec=15s",
            "--property=RuntimeMaxSec=1800s", "--property=StandardOutput=journal", "--property=StandardError=journal",
            "env", "-i"] + [f"{key}={value}" for key, value in env.items()] + ["@node@", f"{support}/e2e/{job['suite']}-suite.mjs"]
    command(argv)
    record["runner"] = properties(job["unit"])
    assert record["runner"]["InvocationID"], "Runner acquisition identity missing"
    print(f"START lane={lane['id']} group={job['name']}", flush=True)


def complete(job, observed):
    record = records[job["name"]]
    assert observed["InvocationID"] == record["runner"]["InvocationID"], "Runner generation changed"
    record["runner"] = observed
    record["elapsedSeconds"] = round(time.monotonic() - record.pop("startedAt"), 3)
    record["finishedSeconds"] = round(time.monotonic() - started, 3)
    record["runnerSettled"] = stop_runner(job)
    for key, filename in (("harness", "run.json"), ("coverage", "coverage.json")):
        record[key] = json.loads(command(["cat", f"{job['evidence']}/{filename}"]))
    record["status"] = "passed"
    validate("group", {"job": job, "lane": lanes[job["lane"]], "result": record, "package": plan["package"]})
    port_closed(lanes[job["lane"]])
    print(f"END lane={job['lane']} group={job['name']} seconds={record['elapsedSeconds']}", flush=True)


try:
    start_all()
    machine.wait_for_unit("multi-user.target")
    guest_ready = True
    with subtest("evidence-symlink-boundary"):
        # A synthetic host-only sentinel, never a credential. An absolute guest
        # link must be rejected before host copytree could dereference it.
        host_sentinel = driver.out_dir.parent / "host-only-evidence-sentinel"
        with host_sentinel.open("x") as sentinel:
            sentinel.write("Synthetic host-only evidence boundary fixture\n")
        command(["mkdir", "-m", "700", "/var/lib/pi-web-evidence-probe"])
        command(["ln", "-s", str(host_sentinel), "/var/lib/pi-web-evidence-probe/host-link"])
        try:
            copy_evidence("/var/lib/pi-web-evidence-probe", "symlink-probe")
        except ValueError as error:
            assert "symbolic link" in str(error), error
        else:
            raise AssertionError("Guest symlink crossed host evidence boundary")
        assert not (driver.out_dir / "symlink-probe").exists()
        probe_passed = True
    for lane in plan["lanes"]:
        with subtest(f"home-manager-{lane['id']}"):
            machine.wait_for_unit(f"home-manager-{lane['user']}.service")
            directory = f"{lane['home']}/fixtures/initial/sessions/smoke"
            timestamp = "2026-10-15T00:00:00.000Z"
            session = f"vm-service-smoke-{lane['id']}"
            transcript = "\n".join(json.dumps(entry) for entry in [
                {"type": "session", "version": 3, "id": session, "timestamp": timestamp, "cwd": lane["home"]},
                {"type": "message", "id": "m1", "parentId": None, "timestamp": timestamp,
                 "message": {"role": "user", "content": [{"type": "text", "text": session}]}}]) + "\n"
            seed = f"umask 077; mkdir -p {directory}; printf %s {shlex.quote(transcript)} > {directory}/2026-10-15T00-00-00-000Z_{session}.jsonl"
            command(["runuser", "-u", lane["user"], "--", "@shell@", "-c", seed])
            # Only the real activation-created default.target link starts the app.
            command(["systemctl", "start", f"user@{lane['uid']}.service"])
            machine.wait_for_unit("pi-web.service", user=lane["user"])
            machine.wait_for_open_port(lane["port"])
            smoke = json.loads(command(["curl", "--fail", "--silent", f"http://127.0.0.1:{lane['port']}/api/sessions"]))
            assert [item["id"] for item in smoke["sessions"]] == [session]
            status, mask = machine.systemctl("show pi-web.service -p UMask --value", user=lane["user"])
            assert status == 0 and mask.strip() == "0077"
            live(lane)
            control(lane, "stop")
            state[lane["id"]]["smoke"] = True

    pending = {lane["id"]: [next(job for job in plan["jobs"] if job["name"] == name) for name in lane["groups"]] for lane in plan["lanes"]}
    active, failures = {}, []
    # Static weighted queues, not concurrent machine.execute calls or shared users.
    while active or (not failures and any(pending.values())):
        for lane_id, queue in pending.items():
            if not failures and queue and lane_id not in active:
                job = queue.pop(0)
                active[lane_id] = job
                try:
                    launch(job)
                except Exception as error:
                    failures.append(f"{job['name']}: {error}")
                    traceback.print_exc()
                    active.pop(lane_id)
        for lane_id, job in list(active.items()):
            observed = properties(job["unit"])
            if observed["MainPID"] != "0" and observed["ActiveState"] in ("active", "activating"):
                continue
            try:
                with subtest(job["name"]):
                    complete(job, observed)
            except Exception as error:
                records[job["name"]]["status"] = "failed"
                failures.append(f"{job['name']}: {error}")
                traceback.print_exc()
                print(command(["journalctl", "-b", "-u", job["unit"], "--no-pager", "-n", "80"]))
            active.pop(lane_id)
        if active:
            time.sleep(0.25)
    assert not failures, "\n".join(failures)

    for lane in plan["lanes"]:
        if not lane["groups"]:
            continue
        with subtest(f"service-restart-{lane['id']}"):
            control(lane, "start")
            machine.wait_for_open_port(lane["port"])
            generation = live(lane)
            url = f"http://127.0.0.1:{lane['port']}/api/sessions?force=1"
            before = json.loads(command(["curl", "--fail", "--silent", url]))
            live(lane, generation)
            status, output = machine.systemctl("restart pi-web.service", user=lane["user"])
            assert status == 0, output
            machine.wait_for_open_port(lane["port"])
            restarted = live(lane)
            assert restarted["InvocationID"] != generation["InvocationID"]
            after = json.loads(command(["curl", "--fail", "--silent", url]))
            before_ids = sorted(item["id"] for item in before["sessions"])
            assert before_ids and before_ids == sorted(item["id"] for item in after["sessions"])
            live(lane, restarted)
            control(lane, "stop")
            state[lane["id"]]["restart"] = True
    passed = True
except Exception:
    traceback.print_exc()  # Preserve the primary even if collection also fails.
    raise
finally:
    if guest_ready:
        # Settle every runner first; collect each lane independently even on errors.
        for job in plan["jobs"]:
            record = records[job["name"]]
            try:
                record["runnerSettled"] = stop_runner(job)
            except Exception as error:
                record["runnerSettled"] = False
                record["stopError"] = str(error)
            if "startedAt" in record:
                record["elapsedSeconds"] = round(time.monotonic() - record.pop("startedAt"), 3)
        for lane in plan["lanes"]:
            result = state[lane["id"]]
            result["runnersStopped"] = all(records[name]["runnerSettled"] for name in lane["groups"])
            try:
                control(lane, "stop")
                observed = dict(line.split("=", 1) for line in control(lane, "status").strip().splitlines())
                group = result.get("cgroup", f"/user.slice/user-{lane['uid']}.slice/user@{lane['uid']}.service/app.slice/pi-web.service")
                result["serviceStopped"] = observed["ActiveState"] == "inactive" and observed["MainPID"] == "0" and empty_cgroup(group, f"/user.slice/user-{lane['uid']}.slice/user@{lane['uid']}.service/")
                port_closed(lane)
            except Exception as error:
                result["serviceStopped"] = False
                result["stopError"] = str(error)
            try:
                stage = f"/var/lib/pi-web-evidence/{lane['id']}"
                command(["mkdir", "-p", f"{stage}/artifacts", f"{stage}/runners"])
                command(["cp", "-a", f"{lane['home']}/evidence/.", f"{stage}/artifacts/"])
                for job in plan["jobs"]:
                    if job["lane"] != lane["id"] or records[job["name"]]["status"] == "not-run":
                        continue
                    runner_log = f"{stage}/runners/{job['name']}.log"
                    machine.succeed(shlex.join(["journalctl", "-b", "-u", job["unit"], "--no-pager", "-o", "cat"]) + " > " + shlex.quote(runner_log))
                    if records[job["name"]]["status"] != "passed":
                        command(["tar", "-czf", f"{stage}/{job['name']}-failed-fixture.tar.gz", "-C", "/", job["fixture"].lstrip("/")])
                result["collected"] = True
            except Exception as error:
                result["collectionError"] = str(error)
                traceback.print_exc()
        collected = False
        try:
            machine.succeed("journalctl -b --no-pager > /var/lib/pi-web-evidence/journal.log")
            copy_evidence("/var/lib/pi-web-evidence", "guest")
            collected = all(item["collected"] for item in state.values())
        except Exception:
            traceback.print_exc()
        receipt = {"version": 2, "plan": plan, "passed": passed, "artifactsCollected": collected, "collectionProbe": probe_passed,
                   "serviceStopped": all(item["serviceStopped"] for item in state.values()),
                   "runnersStopped": all(item["runnersStopped"] for item in state.values()),
                   "lanes": list(state.values()), "groups": list(records.values()),
                   "elapsedSeconds": round(time.monotonic() - started, 3)}
        (driver.out_dir / "acceptance.json").write_text(json.dumps(receipt, indent=2) + "\n")
        validate("receipt", {"plan": plan, "receipt": receipt})
        assert collected, "Missing/incomplete VM evidence collection"
        assert receipt["serviceStopped"] and receipt["runnersStopped"], "Service/runner stop was not established; diagnostics collected, VM bulk must remain"
