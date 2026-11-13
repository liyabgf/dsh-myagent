#!/usr/bin/env python3
"""Run audit commands with durable before/after records. No shell interpretation."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

base = Path(__file__).resolve().parent
if len(sys.argv) < 4 or sys.argv[2] != '--':
    raise SystemExit('usage: run-recorded.py DESCRIPTION -- COMMAND [ARG ...]')
log = base / 'operations.jsonl'
operation = uuid.uuid4().hex
output = base / ('command-' + operation + '.log')

def append(data):
    with log.open('a', encoding='utf-8') as f:
        f.write(json.dumps({'id': operation, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **data}, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())

append({'phase': 'planned', 'description': sys.argv[1], 'cwd': str(Path.cwd()), 'argv': sys.argv[3:], 'output': output.name})
try:
    with output.open('wb') as stream:
        completed = subprocess.run(sys.argv[3:], stdout=stream, stderr=subprocess.STDOUT, check=False)
    append({'phase': 'finished', 'exit': completed.returncode, 'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    print(json.dumps({'exit': completed.returncode, 'output': str(output)}))
    raise SystemExit(completed.returncode)
except OSError as error:
    append({'phase': 'failed-to-start', 'error': str(error)})
    raise
