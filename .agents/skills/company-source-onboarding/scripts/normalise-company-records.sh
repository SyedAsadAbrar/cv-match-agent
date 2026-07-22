#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  "") npm run companies:normalise ;;
  --dry-run) npm run companies:normalise -- --dry-run ;;
  *) echo "Usage: $0 [--dry-run]" >&2; exit 2 ;;
esac
