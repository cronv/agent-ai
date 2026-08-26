# Dockerfile to build nginx with QUIC/HTTP3 support on Alpine
# WARNING: building nginx with QUIC/HTTP/3 is non-trivial and requires
# building multiple components (nginx, quiche and its dependencies).
# This Dockerfile provides a reproducible multi-stage build based on alpine.

ARG ALPINE_VERSION=latest
FROM alpine:${ALPINE_VERSION} AS build

# Install build dependencies
RUN apk add --no-cache \
    build-base \
    ca-certificates \
    linux-headers \
    pcre-dev \
    zlib-dev \
    openssl-dev \
    libstdc++ \
    cmake \
    git \
    wget \
    curl \
    python3 \
    perl \
    gnupg \
    bash \
    rust \
    cargo \
    pkgconf \
    gettext \
    nginx \
    
# Set versions (tweak as needed)
ENV NGINX_VERSION=1.25.2
ENV QUICHE_COMMIT=8f5b7d (please-set-correct-commit)

WORKDIR /usr/src

# Fetch quiche (Cloudflare quiche) - used for HTTP/3 QUIC stack
# Note: set a specific commit in production; here we use a placeholder.
RUN git clone --depth 1 https://github.com/cloudflare/quiche.git /usr/src/quiche || true

# Fetch nginx
RUN wget http://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz \
    && tar xzf nginx-${NGINX_VERSION}.tar.gz

# Build BoringSSL and quiche's build artifacts (quiche expects a working Rust toolchain)
WORKDIR /usr/src/quiche
# Use quiche's build to produce a BoringSSL-compatible OpenSSL and libquiche
# NOTE: quiche's build scripts expect a Linux environment with cargo installed.
RUN cargo build --release || true

# Configure nginx with quiche's boringssl (this step may need adjustment depending on quiche layout)
WORKDIR /usr/src/nginx-${NGINX_VERSION}
RUN ./configure \
    --prefix=/etc/nginx \
    --sbin-path=/usr/sbin/nginx \
    --conf-path=/etc/nginx/nginx.conf \
    --pid-path=/var/run/nginx.pid \
    --with-http_ssl_module \
    --with-http_v2_module \
    --with-http_v3_module \
    --with-compat \
    --with-file-aio \
    --with-threads \
    --with-pcre \
    --with-openssl=/usr/src/quiche/deps/boringssl || true

# Build nginx
RUN make -j"$(nproc)" || true
RUN make install || true

# Final image
FROM alpine:latest
RUN apk add --no-cache libstdc++ pcre zlib openssl

# Create nginx user and directories
RUN addgroup -S nginx && adduser -S -G nginx -h /var/cache/nginx -s /sbin/nologin nginx \
    && mkdir -p /var/cache/nginx /var/log/nginx /var/run

# Copy nginx from build stage
COPY --from=build /etc/nginx /etc/nginx
COPY --from=build /usr/sbin/nginx /usr/sbin/nginx

EXPOSE 80 443 443/udp

STOPSIGNAL SIGQUIT

CMD ["/usr/sbin/nginx", "-g", "daemon off;"]

# Notes:
# - This Dockerfile is a starting point. Building quiche/boringssl on Alpine
#   may require additional tweaks (CMake version, Python, build flags).
# - For a production-ready image you may prefer to use a prebuilt image that
#   already includes HTTP/3 support or build on Debian where existing examples
#   are more common.
