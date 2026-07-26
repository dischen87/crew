FROM redis:8.8.0-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005

COPY infra/redis/start.sh /usr/local/bin/crew-redis
RUN chown redis:redis /usr/local/bin/crew-redis \
	&& chmod 0555 /usr/local/bin/crew-redis

USER redis
ENTRYPOINT ["/usr/local/bin/crew-redis"]
