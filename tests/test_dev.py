"""Check development bootstrap retries and fail-fast behavior without Docker."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DevTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        binary = self.base / "bin"
        binary.mkdir()
        self.log = self.base / "commands"
        self.env = dict(os.environ, PATH=f"{binary}:{os.environ['PATH']}",
                        STATISTICS_DIY_DEV_WORKSPACE=str(self.base),
                        GIT_CONFIG_GLOBAL=str(self.base / "gitconfig"),
                        SITE_NAME="statistics.localhost", DB_ROOT_PASSWORD="test",
                        ADMIN_PASSWORD="test", BENCH_LOG=str(self.log))
        stubs = {
            "bench": '''#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$BENCH_LOG"
if [[ "$1" == init ]]; then
  mkdir -p bench/apps/frappe bench/env/bin bench/config bench/sites
  touch bench/env/bin/python
  chmod +x bench/env/bin/python
elif [[ "$1" == get-app ]]; then
  mkdir -p apps/statistics_diy
elif [[ "$1" == new-site ]]; then
  mkdir -p "sites/$2"
  touch "sites/$2/site_config.json"
elif [[ "$*" == *install-app* && "${FAIL_INSTALL:-0}" == 1 ]]; then
  exit 7
fi
''',
            "redis-server": "#!/usr/bin/env bash\nexec sleep 60\n",
            "redis-cli": "#!/usr/bin/env bash\nexit 0\n",
        }
        for name, content in stubs.items():
            target = binary / name
            target.write_text(content)
            target.chmod(0o755)

    def run_dev(self, **variables):
        return subprocess.run(["bash", str(ROOT / "scripts/dev-bench.sh")],
                              env=dict(self.env, **variables), capture_output=True,
                              text=True, timeout=10)

    def test_first_run_and_reuse(self):
        for _ in range(2):
            result = self.run_dev()
            self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.log.read_text().splitlines()
        self.assertEqual(sum(command.startswith("init ") for command in commands), 1)
        self.assertEqual(sum(command.startswith("new-site ") for command in commands), 1)
        self.assertEqual(sum(command.startswith("get-app ") for command in commands), 1)
        self.assertEqual(commands.count("start"), 2)
        self.assertEqual(commands[-1], "start")

    def test_failed_install_does_not_start_and_can_retry(self):
        result = self.run_dev(FAIL_INSTALL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("start", self.log.read_text().splitlines())
        result = self.run_dev()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().splitlines()[-1], "start")

    def test_incomplete_bench_is_preserved(self):
        bench = self.base / "bench"
        bench.mkdir()
        marker = bench / "keep"
        marker.write_text("existing data")
        result = self.run_dev()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(marker.read_text(), "existing data")
        self.assertFalse(self.log.exists())
