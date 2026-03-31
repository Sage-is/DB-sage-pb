# syntax=docker/dockerfile:1.5
# =============================================================================
# Sage PocketBase — three-stage build from source
#   1. ui-builder:  Node.js — npm install, replace branding, vite build
#   2. go-builder:  Go — compile PocketBase with custom UI embedded
#   3. runtime:     Alpine — just the binary (~15 MB)
# =============================================================================

ARG PB_VERSION=0.36.8

# =============================================================================
# Stage 1: UI — build admin interface with custom Sage.is branding
# =============================================================================
FROM node:20-alpine AS ui-builder

ARG PB_VERSION

RUN apk add --no-cache git

WORKDIR /src

# Clone PocketBase source at the specified version
RUN git clone --depth 1 --branch v${PB_VERSION} https://github.com/pocketbase/pocketbase.git .

WORKDIR /src/ui

# Install UI dependencies
RUN npm ci

# Replace branding assets with Sage.is versions
COPY branding/logo.svg /src/ui/public/images/logo.svg
COPY branding/favicon/ /src/ui/public/images/favicon/

# Build the admin UI (output: /src/ui/dist/)
RUN npm run build

# =============================================================================
# Stage 2: GO — compile PocketBase binary with custom UI embedded
# =============================================================================
FROM golang:1.25-alpine AS go-builder

ARG TARGETARCH

WORKDIR /src

# Copy full PocketBase source from ui-builder (includes go.mod, go.sum, etc.)
COPY --from=ui-builder /src /src

# Download Go dependencies
RUN go mod download

# Build the PocketBase binary (statically linked, no CGO)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -o /pocketbase ./cmd/base

# =============================================================================
# Stage 3: RUNTIME — minimal Alpine with just the binary
# =============================================================================
FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=go-builder /pocketbase /usr/local/bin/pocketbase

WORKDIR /app

# PocketBase data volume
VOLUME /app/pb_data

EXPOSE 8090

CMD ["pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/app/pb_data"]
