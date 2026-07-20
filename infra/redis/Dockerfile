FROM redis:8.8.0-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005

COPY --chmod=0555 --chown=redis:redis infra/redis/start.sh /usr/local/bin/crew-redis

USER redis
ENTRYPOINT ["/usr/local/bin/crew-redis"]
