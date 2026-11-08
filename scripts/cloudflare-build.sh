#!/usr/bin/env bash
# Build the site on Cloudflare Pages.
# Set the Cloudflare Pages build command to: bash scripts/cloudflare-build.sh
set -euo pipefail

# Keep this version the same as the version in .github/workflows/ci.yml.
curl -fsSL https://mise.run | MISE_VERSION=v2026.9.17 sh
# Tasks call mise, so put mise on the PATH.
export PATH="$HOME/.local/bin:$PATH"

# Use only the project configuration. Ignore the mise configuration of the
# build image.
# mise reads a file only if its name has the .toml extension.
empty_config="$(mktemp -d)/config.toml"
touch "$empty_config"
export MISE_GLOBAL_CONFIG_FILE="$empty_config"
export MISE_SYSTEM_CONFIG_FILE="$empty_config"
export MISE_CEILING_PATHS="$(dirname "$PWD")"
export MISE_TRUSTED_CONFIG_PATHS="$PWD"

# The build log does not show colors. mise and Vite use colors when CI is set,
# and Cloudflare Pages sets CI.
export NO_COLOR=1

# Add the tools in .config/mise.cloudflare.toml.
export MISE_ENV=cloudflare

mise run build
