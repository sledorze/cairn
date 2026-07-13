#!/usr/bin/env bash
set -euo pipefail

echo "=== cairn: post-create setup ==="

# Install dependencies (frozen — reproducible from the committed lockfile)
if [ -f "package.json" ]; then
  echo "Installing pnpm dependencies..."
  pnpm install --frozen-lockfile
fi

# Install git hooks
if [ -f "lefthook.yml" ]; then
  echo "Installing lefthook git hooks..."
  lefthook install
fi

echo ""
echo "Installed tools:"
echo "   - Node.js:   $(node --version)"
echo "   - pnpm:      $(pnpm --version)"
echo "   - gh:        $(gh --version | head -1)"
echo "   - gitleaks:  $(gitleaks version 2>/dev/null || echo 'n/a')"
echo "   - hadolint:  $(hadolint --version 2>/dev/null || echo 'n/a')"
echo "   - lefthook:  $(lefthook --version 2>/dev/null || echo 'n/a')"
echo ""
echo "Verify everything: pnpm verify"
echo "=== setup complete ==="
