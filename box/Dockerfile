# syntax=docker/dockerfile:1
# The bot computer ("box"): a thin image with Node, the unmodified `claude`
# CLI, the ACP adapter that drives it over stdio, git, gh, glab and curl.
# Nothing else is bundled and nothing is auto-installed at runtime; whatever a
# bot needs beyond this is installed by a person and persists in the home
# volume. The default command is the ACP adapter, so `docker run -i` gives the
# host a JSON-RPC session on stdin/stdout.

FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.251
ARG CLAUDE_CODE_ACP_VERSION=0.16.2
ARG GH_VERSION=2.98.0
ARG GLAB_VERSION=1.115.0

# gh and glab come from their release .deb packages, verified against the
# checksum file each project publishes with the release.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git curl ca-certificates; \
    arch="$(dpkg --print-architecture)"; \
    cd /tmp; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.deb"; \
    curl -fsSLO "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_checksums.txt"; \
    grep " gh_${GH_VERSION}_linux_${arch}.deb\$" "gh_${GH_VERSION}_checksums.txt" | sha256sum -c -; \
    curl -fsSLO "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/${GLAB_VERSION}/glab_${GLAB_VERSION}_linux_${arch}.deb"; \
    curl -fsSL -o glab_checksums.txt "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/${GLAB_VERSION}/checksums.txt"; \
    grep " glab_${GLAB_VERSION}_linux_${arch}.deb\$" glab_checksums.txt | sha256sum -c -; \
    apt-get install -y --no-install-recommends "./gh_${GH_VERSION}_linux_${arch}.deb" "./glab_${GLAB_VERSION}_linux_${arch}.deb"; \
    rm -f /tmp/*.deb /tmp/*.txt; \
    rm -rf /var/lib/apt/lists/*

# The unmodified Claude Code CLI and the ACP adapter, pinned.
RUN npm install -g --no-fund --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@zed-industries/claude-code-acp@${CLAUDE_CODE_ACP_VERSION}" \
    && npm cache clean --force

# The adapter drives the globally installed CLI, a native binary (not the copy bundled with its
# own SDK dependency); the CLI must not update itself out from under the pin.
ENV CLAUDE_CODE_EXECUTABLE=/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
ENV DISABLE_AUTOUPDATER=1

# Non-root user; the whole home is a volume so ~/.claude (credentials,
# sessions, settings) and anything installed by hand survive container
# restarts.
RUN useradd --create-home --shell /bin/bash --uid 1001 bot \
    && mkdir -p /home/bot/work \
    && chown -R bot:bot /home/bot
USER bot
WORKDIR /home/bot/work
VOLUME /home/bot

CMD ["claude-code-acp"]
