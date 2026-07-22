#!/usr/bin/env bash
set -euo pipefail
limit="25"
if [[ "${1:-}" == "--limit" ]]; then
  limit="${2:?--limit requires a number}"
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--limit NUMBER]" >&2
  exit 2
fi
[[ "$limit" =~ ^[1-9][0-9]*$ ]] || { echo "Limit must be a positive integer" >&2; exit 2; }
npm run companies:verify -- --limit "$limit"
