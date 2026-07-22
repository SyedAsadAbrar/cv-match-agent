#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 0 ]] || { echo "This command accepts no arguments" >&2; exit 2; }
npm run companies:stats
