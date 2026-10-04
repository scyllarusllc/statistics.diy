"""Host-side installer contract checks; Docker/downloads are simulated."""

import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.install = self.base / "installation with spaces"
        self.log = self.base / "docker.log"
        for archive, source in (("app", ROOT / "deploy"), ("docker", None)):
            tree = self.base / archive / "root"
            tree.mkdir(parents=True)
            if source:
                (tree / "deploy").mkdir()
                (tree / "deploy/compose.yaml").write_text((source / "compose.yaml").read_text())
            else:
                (tree / "images/custom").mkdir(parents=True)
                (tree / "images/custom/Containerfile").touch()
            with tarfile.open(self.base / f"{archive}.tar.gz", "w:gz") as dest:
                dest.add(tree, arcname="root")
        self.executable("curl", '''#!/usr/bin/env bash
set -eu
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    http*) url="$1" ;;
    -o) shift; output="$1" ;;
  esac
  shift
done
case "$url" in
  http://127.0.0.1:*) exit 0 ;;
  *frappe_docker*) cp "$FIXTURES/docker.tar.gz" "$output" ;;
  *statistics.diy*) cp "$FIXTURES/app.tar.gz" "$output" ;;
  *) exit 9 ;;
esac
''')
        self.executable("docker", '''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "${FAIL_BUILD:-0}" = 1 ] && [ "$1" = build ]; then exit 7; fi
''')
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        STATISTICS_DIY_DIR=str(self.install), STATISTICS_DIY_PORT="8081",
                        FIXTURES=str(self.base), DOCKER_LOG=str(self.log))

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def run_installer(self, **variables):
        # stdin emulates curl | bash, so tests catch accidental interactive reads.
        return subprocess.run(["bash"], input=(ROOT / "install.sh").read_text(),
                              text=True, capture_output=True, env=dict(self.env, **variables), timeout=30)

    def test_install_and_retry_preserve_credentials(self):
        first = self.run_installer()
        self.assertEqual(first.returncode, 0, first.stderr)
        env_file = self.install / ".env"
        settings = env_file.read_text()
        self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
        self.assertIn("HTTP_PORT=8081", settings)
        password = next(line.split("=", 1)[1] for line in settings.splitlines()
                        if line.startswith("ADMIN_PASSWORD="))
        self.assertNotIn(password, first.stdout + first.stderr)
        self.assertIn("http://localhost:8081", first.stdout)
        second = self.run_installer(STATISTICS_DIY_PORT="9000")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(env_file.read_text(), settings)
        self.assertFalse((self.install / ".install-lock").exists())
        commands = self.log.read_text()
        self.assertLess(commands.index("run --rm configurator"), commands.index("run --rm create-site"))
        self.assertIn("exec -T backend bench --site statistics.localhost list-apps", commands)

    def test_build_failure_is_retryable(self):
        failed = self.run_installer(FAIL_BUILD="1")
        self.assertNotEqual(failed.returncode, 0)
        self.assertNotIn("Installed Frappe", failed.stdout)
        self.assertFalse((self.install / ".install-lock").exists())
        settings = (self.install / ".env").read_text()
        self.assertEqual(self.run_installer().returncode, 0)
        self.assertEqual((self.install / ".env").read_text(), settings)

    def test_rejects_invalid_port_and_nonempty_directory(self):
        bad_port = self.run_installer(STATISTICS_DIY_PORT="0")
        self.assertNotEqual(bad_port.returncode, 0)
        self.assertFalse((self.install / ".env").exists())
        (self.install / "keep.txt").write_text("existing data")
        occupied = self.run_installer()
        self.assertNotEqual(occupied.returncode, 0)
        self.assertEqual((self.install / "keep.txt").read_text(), "existing data")


if __name__ == "__main__":
    unittest.main()
