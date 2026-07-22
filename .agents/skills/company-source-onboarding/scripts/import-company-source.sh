#!/usr/bin/env bash
set -euo pipefail
directory="data/company-sources"
dry_run=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --directory) directory="${2:?--directory requires a path}"; shift 2 ;;
    --dry-run) dry_run="--dry-run"; shift ;;
    *) echo "Unsupported argument: $1" >&2; exit 2 ;;
  esac
done
npm run companies:import -- --directory "$directory" $dry_run
