#!/bin/bash
# First-boot setup for the app instance (Amazon Linux 2023): Docker, Compose, git, swap.
# Each step is independent: one failed download must not skip the others.
# Progress: sudo tail -f /var/log/cloud-init-output.log
set -ux
BUILDX_VERSION=v0.26.1        # fallback if the "latest" lookup fails
PLUGINS=/usr/local/lib/docker/cli-plugins

dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p "$PLUGINS"

case "$(uname -m)" in         # Intel/AMD (t3, m7i) or Graviton (t4g, m7g)
  aarch64) COMPOSE_ARCH=aarch64; BUILDX_ARCH=arm64 ;;
  *)       COMPOSE_ARCH=x86_64;  BUILDX_ARCH=amd64 ;;
esac

fetch() {   # url dest: download with retries, make executable
  for i in 1 2 3 4 5; do
    curl -fsSL --retry 3 "$1" -o "$2.tmp" && mv "$2.tmp" "$2" && chmod +x "$2" && return 0
    sleep 10
  done
  echo "FAILED to download $1" >&2
  return 1
}

fetch "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" \
  "$PLUGINS/docker-compose"

latest=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest 2>/dev/null \
         | grep -m1 '"tag_name"' | cut -d'"' -f4)
fetch "https://github.com/docker/buildx/releases/download/${latest:-$BUILDX_VERSION}/buildx-${latest:-$BUILDX_VERSION}.linux-${BUILDX_ARCH}" \
  "$PLUGINS/docker-buildx" \
  || fetch "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${BUILDX_ARCH}" \
       "$PLUGINS/docker-buildx"

# 2 GB swap: headroom while building the images
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile \
    && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker compose version && echo "AGCLIMATE SETUP DONE"
