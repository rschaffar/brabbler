"""One boot, the real Home Manager user service, and immutable package inputs."""
from datetime import timedelta
import json
import os
from pathlib import Path
import shlex
import traceback

support = "@support@"
package = "@package@"
groups = json.loads(Path(support, "nix/e2e-groups.json").read_text())
focus = os.environ.get("PI_WEB_E2E_GROUP", "all")
if focus != "all" and focus not in groups:
    raise ValueError("Unknown E2E group")
selected = list(groups) if focus == "all" else [focus]
passed = False
guest_ready = False
active_fixture = None


def live(expected=None):
    output = machine.succeed("runuser -u tester -- @controller@ status")
    state = dict(line.split("=", 1) for line in output.strip().splitlines())
    assert state["ActiveState"] == "active" and state["SubState"] == "running"
    assert state["MainPID"] != "0" and state["NRestarts"] == "0"
    assert state["InvocationID"]
    if expected:
        assert (state["InvocationID"], state["MainPID"]) == (expected["InvocationID"], expected["MainPID"])
    return state


try:
    start_all()
    machine.wait_for_unit("multi-user.target")
    guest_ready = True
    machine.wait_for_unit("home-manager-tester.service")
    smoke_dir = "/home/tester/fixtures/initial/sessions/smoke"
    smoke_file = f"{smoke_dir}/2026-10-15T00-00-00-000Z_vm-service-smoke.jsonl"
    timestamp = "2026-10-15T00:00:00.000Z"
    transcript = "\n".join(json.dumps(entry) for entry in [
        {"type": "session", "version": 3, "id": "vm-service-smoke", "timestamp": timestamp, "cwd": "/home/tester"},
        {"type": "message", "id": "m1", "parentId": None, "timestamp": timestamp,
         "message": {"role": "user", "content": [{"type": "text", "text": "VM service smoke"}]}},
    ]) + "\n"
    seed = f"umask 077; mkdir -p {smoke_dir}; printf %s {shlex.quote(transcript)} > {smoke_file}"
    machine.succeed(shlex.join(["runuser", "-u", "tester", "--", "@shell@", "-c", seed]))
    # Start the manager only after first Home Manager activation, so the real
    # default.target.wants link (not a second handwritten unit) starts the app.
    machine.succeed("systemctl start user@1000.service")
    machine.wait_for_unit("pi-web.service", user="tester")
    machine.wait_for_open_port(30141)
    smoke = json.loads(machine.succeed("curl --fail --silent http://127.0.0.1:30141/api/sessions"))
    assert [item["id"] for item in smoke["sessions"]] == ["vm-service-smoke"]
    status, mask = machine.systemctl("show pi-web.service -p UMask --value", user="tester")
    assert status == 0 and mask.strip() == "0077"
    machine.succeed("runuser -u tester -- @controller@ stop")

    for index, group in enumerate(selected):
        with subtest(group):
            # Bound SDK/Playwright Unix socket paths, independent of group names.
            fixture = f"/home/tester/f/{index:02d}"
            active_fixture = fixture
            evidence = f"/home/tester/evidence/{group}"
            machine.succeed(f"install -d -m 700 -o tester -g users {fixture} {evidence}")
            env = {
                "PATH": "/run/current-system/sw/bin",
                "HOME": "/home/tester",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "SHELL": "@shell@",
                "E2E_PACKAGE_ROOT": package,
                "E2E_BASE_URL": "http://127.0.0.1:30141",
                "E2E_SERVICE_CONTROL": "@controller@",
                "E2E_SERVICE_ENV": "/home/tester/service.env",
                "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH": "@chromium@",
                "PI_WEB_TEST_FIXTURES": fixture,
                "PI_WEB_TEST_ARTIFACTS": evidence,
                "PI_WEB_TEST_TMP": f"{fixture}/tmp",
            }
            selector = groups[group]["selector"]
            if selector:
                env[selector] = "1"
            argv = ["runuser", "-u", "tester", "--", "env", "-i"]
            argv += [f"{key}={value}" for key, value in env.items()]
            argv += ["@node@", f"{support}/e2e/{groups[group]['suite']}-suite.mjs"]
            command = shlex.join(argv) + f" > {evidence}/suite.log 2>&1"
            try:
                machine.succeed(command, timeout=timedelta(minutes=30))
            except Exception:
                print(machine.succeed(f"tail -c 65536 {evidence}/suite.log"))
                raise
            result = json.loads(machine.succeed(f"cat {evidence}/run.json"))
            assert result["status"] == "passed" and result["resourcesSettled"]
            assert result["server"]["scope"] == "systemd-user-service"
            assert result["server"]["settled"]
            machine.fail("curl --fail --silent http://127.0.0.1:30141/api/sessions")

    # A real service restart/persistence check, independent of browser contexts.
    with subtest("service-restart"):
        machine.succeed("runuser -u tester -- @controller@ start")
        machine.wait_for_open_port(30141)
        generation = live()
        before = machine.succeed("curl --fail --silent 'http://127.0.0.1:30141/api/sessions?force=1'")
        live(generation)
        code, output = machine.systemctl("restart pi-web.service", user="tester")
        assert code == 0, output
        machine.wait_for_open_port(30141)
        restarted = live()
        assert restarted["InvocationID"] != generation["InvocationID"]
        after = machine.succeed("curl --fail --silent 'http://127.0.0.1:30141/api/sessions?force=1'")
        before_ids = sorted(item["id"] for item in json.loads(before)["sessions"])
        after_ids = sorted(item["id"] for item in json.loads(after)["sessions"])
        assert before_ids and before_ids == after_ids
        live(restarted)
        machine.succeed("runuser -u tester -- @controller@ stop")
    passed = True
except Exception:
    # The driver's bounded exception renderer omits chained primary failures.
    # Print the original before a later collection/stop failure can replace it.
    traceback.print_exc()
    raise
finally:
    if guest_ready:
        # Never start/retry an unbooted VM merely to collect diagnostics.
        code, output = machine.execute("runuser -u tester -- @controller@ stop")
        stopped = False
        if code == 0:
            code, state = machine.execute("runuser -u tester -- @controller@ status")
            stopped = code == 0 and "ActiveState=inactive" in state and "MainPID=0" in state
        if not passed and active_fixture:
            machine.succeed(
                "tar -czf /home/tester/evidence/failed-fixture.tar.gz -C / "
                + shlex.quote(active_fixture.lstrip("/"))
            )
        machine.succeed("journalctl -b --no-pager > /home/tester/evidence/journal.log")
        machine.copy_from_machine("/home/tester/evidence", "guest")
        (driver.out_dir / "acceptance.json").write_text(json.dumps({
            "version": 1, "package": package, "selected": selected, "passed": passed,
            "artifactsCollected": True, "serviceStopped": stopped,
        }, indent=2) + "\n")
        assert stopped, "Service stop was not established; diagnostics collected, VM bulk must remain"
