#!/bin/bash
# First-boot setup for the app instance (Amazon Linux 2023): Docker, Compose, git, swap.
set -euxo pipefail
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
BUILDX=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
curl -fsSL "https://github.com/docker/buildx/releases/download/${BUILDX}/buildx-${BUILDX}.linux-amd64" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/local/lib/docker/cli-plugins/*
# 2 GB swap: building the Next.js image needs more than a t3.small's 2 GB RAM
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
