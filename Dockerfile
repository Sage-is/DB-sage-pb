# syntax=docker/dockerfile:1.5
# =============================================================================
# PocketBase — single-stage Alpine build
# Downloads the PocketBase binary at build time for the target platform.
# =============================================================================

ARG PB_VERSION=0.36.8

FROM alpine:3.21

ARG PB_VERSION
ARG TARGETARCH

# Install ca-certificates (for HTTPS/Resend) and wget
RUN apk add --no-cache ca-certificates wget unzip

# Download PocketBase for the target architecture
RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
    -O /tmp/pocketbase.zip \
    && unzip /tmp/pocketbase.zip -d /usr/local/bin/ \
    && rm /tmp/pocketbase.zip \
    && chmod +x /usr/local/bin/pocketbase

WORKDIR /app

# PocketBase data volume
VOLUME /app/pb_data

EXPOSE 8090

CMD ["pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/app/pb_data"]
