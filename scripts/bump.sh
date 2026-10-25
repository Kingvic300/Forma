#!/usr/bin/env bash
# Set the app version everywhere it lives, commit, tag and push. The tag starts the release build.
# Usage: scripts/bump.sh 0.2.0
set -euo pipefail
v="${1:?usage: scripts/bump.sh <version>}"
cd "$(dirname "$0")/.."
npm version "$v" --no-git-tag-version >/dev/null
sed -i.bak -E "s/^version = \".*\"/version = \"$v\"/" src-tauri/Cargo.toml && rm src-tauri/Cargo.toml.bak
sed -i.bak -E "s/\"version\": \"[^\"]*\"/\"version\": \"$v\"/" src-tauri/tauri.conf.json && rm src-tauri/tauri.conf.json.bak
(cd src-tauri && cargo update -p forma --offline >/dev/null 2>&1 || true)
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: release v$v"
git tag "v$v"
git push origin HEAD "v$v"
