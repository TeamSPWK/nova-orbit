#!/bin/bash
# Nova Rules Sync — copies Nova core rules for build-time bundling
# Usage: npm run sync:nova (or bash scripts/sync-nova-rules.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NOVA_DIR="${NOVA_DIR:-$(dirname "$PROJECT_ROOT")/nova}"
TARGET="$PROJECT_ROOT/server/core/nova-rules"

if [ ! -d "$NOVA_DIR" ]; then
  echo "⚠ Nova directory not found at $NOVA_DIR — using existing bundled rules"
  exit 0
fi

echo "Syncing Nova rules from $NOVA_DIR..."

# Copy core rule files
cp "$NOVA_DIR/docs/nova-rules.md" "$TARGET/rules.md"
cp "$NOVA_DIR/.claude/skills/evaluator/SKILL.md" "$TARGET/evaluator-protocol.md"
cp "$NOVA_DIR/.claude/skills/orchestrator/SKILL.md" "$TARGET/orchestrator-protocol.md"

# Read Nova release version
VERSION_FILE="$NOVA_DIR/scripts/.nova-version"
if [ -f "$VERSION_FILE" ]; then
  NOVA_VERSION=$(cat "$VERSION_FILE")
else
  NOVA_VERSION="unknown"
fi

COMMIT=$(cd "$NOVA_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

cat > "$TARGET/version.json" <<EOF
{
  "novaVersion": "$NOVA_VERSION",
  "novaCommit": "$COMMIT",
  "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "✓ Nova rules synced (v$NOVA_VERSION, commit: $COMMIT)"
