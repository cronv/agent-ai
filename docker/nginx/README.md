# Notes for the docker/nginx build and runtime

This directory contains a template Dockerfile and nginx.conf.template for
building nginx with HTTP/3 (QUIC) support. The provided Dockerfile is a
starting point and must be tested and adjusted for specific quiche/nginx
versions and CI environment.

Key points:
- HTTP/3 requires QUIC (UDP) and TLS1.3. The nginx binary must be built
  with http_v3 and linked against a QUIC-capable TLS stack (quiche/boringssl
  or equivalent).
- The build is resource-intensive and may take significant time.
- The runtime image must allow UDP 443 to be reachable (Docker/host/Cloud
  LB configuration needed).

Quick test suggestions:
- Build locally on a machine with enough RAM/CPU, or use CI with caching.
- Provide valid TLS certs under /etc/ssl/certs/fullchain.pem and /etc/ssl/private/privkey.pem
- Test HTTP/3 using a client that supports it (eg. curl built with quiche/nghttp3)

Alternative (recommended for quick production rollout):
- Use a dedicated HTTP/3 terminator (Caddy, Envoy, or HAProxy) in front of
  your existing nginx (terminate QUIC/TLS there, proxy to nginx over HTTP/2).
  This avoids complex nginx builds and simplifies upgrades.
