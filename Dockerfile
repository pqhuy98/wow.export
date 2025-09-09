# Multi-stage build for wow.export (Linux x64)

ARG NODE_IMAGE=node:14-bullseye
ARG UBUNTU_IMAGE=ubuntu:22.04

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . /app/wow.export/

# Ensure submodule git metadata does not break npm install
RUN rm -rf /app/wow.export/.git

WORKDIR /app/wow.export
RUN npm install --no-audit --no-fund

# Build the linux-x64 binary into bin/linux-x64/
RUN node build linux-x64


# --- Runtime: minimal Ubuntu with required GUI/X dependencies + xvfb
FROM ${UBUNTU_IMAGE} AS runtime
WORKDIR /opt/wow.export

# X/GTK/Audio libs required by the UI binary even when only using RCP
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  xvfb \
  libgbm1 \
  libgl1 \
  libxshmfence1 \
  libglib2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  libatspi2.0-0 \
  libxrandr2 \
  libxss1 \
  libgtk-3-0 \
  libgdk-pixbuf2.0-0 \
  libnss3 \
  libnspr4 \
  libdrm2 \
  libxcb1 \
  libx11-6 \
  libxext6 \
  libxrender1 \
  libxinerama1 \
  libxi6 \
  libxtst6 \
  libxkbcommon0 \
  libpangocairo-1.0-0 \
  libx11-xcb1 \
  libxcb-dri3-0 \
  upower \
  dbus \
  libatomic1 \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy built wow.export app directory
COPY --from=builder /app/wow.export/bin/linux-x64/ /opt/wow.export/

# Ensure the main binary is executable
RUN chmod +x /opt/wow.export/wow.export

# Make bundled runtime files world-readable so a non-root user can load libs
RUN chown -R root:root /opt/wow.export && chmod -R a+rX /opt/wow.export

# RPC listens on 17751 by default
EXPOSE 17751
EXPOSE 17752

ENV DISPLAY=:99
ENV LD_LIBRARY_PATH=/opt/wow.export:/opt/wow.export/lib
ENV HOME=/tmp \
  XDG_CONFIG_HOME=/tmp/xdg-config \
  XDG_CACHE_HOME=/tmp/xdg-cache \
  XDG_DATA_HOME=/tmp/xdg-data

# Prepare writable dirs for Chromium/NW.js profile, cache, and crashpad DB
RUN mkdir -p /tmp/xdg-config /tmp/xdg-cache /tmp/xdg-data /tmp/wowexport \
  && chmod -R 777 /tmp/xdg-config /tmp/xdg-cache /tmp/xdg-data /tmp/wowexport

# Add entrypoint to run under Xvfb (build context is wow.export/)
COPY docker/helpers/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

