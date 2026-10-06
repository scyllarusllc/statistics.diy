"""Verify port conflict prompts without stopping real services."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PortTests(unittest.TestCase):
    def run_check(self, answer, occupied=True, container=True, port='8000'):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            log = base / 'log'
            marker = base / 'occupied'
            if occupied:
                marker.touch()
            scripts = {
                'ss': '#!/bin/bash\nif [[ -e "$MARKER" ]]; then echo \'LISTEN 0 128 127.0.0.1:8000 0.0.0.0:* users:(("docker-proxy",pid=999999,fd=7))\'; fi\n',
                'docker': '#!/bin/bash\nif [[ "$1" == ps && "$CONTAINER" == 1 && -e "$MARKER" ]]; then echo "abc|statistics-dev|127.0.0.1:8000->8000/tcp"; elif [[ "$1" == stop ]]; then echo "$*" >> "$LOG"; rm -f "$MARKER"; fi\n',
            }
            for name, content in scripts.items():
                target = base / name
                target.write_text(content)
                target.chmod(0o755)
            env = dict(os.environ, PATH=f'{base}:{os.environ["PATH"]}',
                       LOG=str(log), MARKER=str(marker), CONTAINER=str(int(container)))
            command = f'kill() {{ echo "kill $*" >> "$LOG"; rm -f "$MARKER"; }}; source "{ROOT}/scripts/dev-ports.sh"; ensure_dev_port "$PORT" TEST_PORT'
            env['PORT'] = port
            result = subprocess.run(['bash', '-c', command], env=env,
                                    input=answer, capture_output=True, text=True, timeout=5)
            return result, log.read_text() if log.exists() else ''

    def test_free_port(self):
        result, log = self.run_check('', occupied=False)
        self.assertEqual(result.returncode, 0)
        self.assertNotIn('Stop these', result.stderr)
        self.assertEqual(log, '')

    def test_decline_does_not_stop(self):
        for answer in ['n\n', '\n', '']:
            result, log = self.run_check(answer)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(log, '')

    def test_confirm_stops_container_and_continues(self):
        result, log = self.run_check('yes\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, 'stop abc\n')
        self.assertIn('statistics-dev', result.stderr)

    def test_invalid_port(self):
        result, log = self.run_check('yes\n', port='70000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Invalid', result.stderr)
        self.assertEqual(log, '')

    def test_confirm_terminates_host_process(self):
        result, log = self.run_check('y\n', container=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log, 'kill -TERM 999999\n')
