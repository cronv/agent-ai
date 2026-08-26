# Dockerfile: build nginx with HTTP/3 (quiche) and produce a runtime image based on alpine:latest
ARG ALPINE_VERSION=latest
ARG NGINX_GIT="https://github.com/nginx/nginx.git"
ARG NGINX_BRANCH="master"
ARG QUICHE_GIT="https://github.com/cloudflare/quiche.git"
ARG QUICHE_TAG="master"

# ---- build stage ----
FROM alpine:latest AS builder

ARG NGINX_GIT
ARG NGINX_BRANCH
ARG QUICHE_GIT
ARG QUICHE_TAG

RUN apk add --no-cache \
    build-base \
    pcre-dev \
    zlib-dev \
    linux-headers \
    openssl-dev \
    cmake \
    git \
    ca-certificates \
    python3 \
    perl \
    curl \
    musl-dev

# Install latest Rust via rustup (Alpine's package version is too old for edition 2024)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    . "$HOME/.cargo/env" && \
    rustup default stable

# Add cargo to PATH for subsequent RUN commands
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build

# Clone nginx and quiche (shallow)
RUN git clone --depth 1 --branch ${NGINX_BRANCH} ${NGINX_GIT} nginx && \
    git clone --depth 1 --branch ${QUICHE_TAG} ${QUICHE_GIT} quiche

# Build quiche
WORKDIR /build/quiche
RUN git submodule update --init --recursive && \
    cargo build --release --package quiche

# Configure and build nginx with HTTP/3/quic support
WORKDIR /build/nginx

RUN ./auto/configure \
    --with-cc-opt='-I/build/quiche/quiche/include' \
    --with-ld-opt='-L/build/quiche/target/release -Wl,-rpath,/build/quiche/target/release' \
    --with-http_v3_module \
    --with-stream_quic_module \
    --with-openssl=/build/quiche/quiche/deps/boringssl \
    --prefix=/etc/nginx && \
    make -j$(nproc) && \
    make install

# ---- runtime stage ----
FROM alpine:${ALPINE_VERSION} AS runtime

RUN apk add --no-cache \
    libgcc \
    pcre \
    zlib \
    openssl

# Copy nginx files from builder
COPY --from=builder /etc/nginx /etc/nginx
COPY --from=builder /build/nginx/objs/nginx /usr/sbin/nginx

# Default config (user should replace certs and tune TLS ciphers)
COPY nginx.conf.template /etc/nginx/nginx.conf

# Expose TCP and UDP 443 for HTTP/3 (QUIC uses UDP)
EXPOSE 80/tcp 443/tcp 443/udp

STOPSIGNAL SIGTERM

CMD ["nginx", "-g", "daemon off;"]
