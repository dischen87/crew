#!/bin/sh
set -eu

require_secret() {
	name=$1
	value=$2
	case "$value" in
		*[!A-Za-z0-9_-]* | '')
			echo "$name must be non-empty URL-safe secret material" >&2
			exit 1
			;;
	esac
	if [ "${#value}" -lt 16 ]; then
		echo "$name must contain at least 16 characters" >&2
		exit 1
	fi
}

require_secret REDIS_GATEWAY_PASSWORD "${REDIS_GATEWAY_PASSWORD:-}"
require_secret REDIS_USER_PASSWORD "${REDIS_USER_PASSWORD:-}"

umask 077
{
	echo "user default off resetpass resetkeys resetchannels -@all"
	echo "user crew_gateway reset on >${REDIS_GATEWAY_PASSWORD} resetkeys ~crew:gateway:rate:v1:* resetchannels -@all +select +ping +eval +time +zremrangebyscore +pttl +zcard +zrange +set +zadd +pexpireat +get +incr"
	echo "user crew_user reset on >${REDIS_USER_PASSWORD} resetkeys ~crew:user:rate:v1:* resetchannels -@all +select +ping +eval +time +zremrangebyscore +pttl +zcard +zrange +set +zadd +pexpireat +get +incr"
} > /data/users.acl

exec redis-server \
	--bind 0.0.0.0 \
	--protected-mode yes \
	--port 6379 \
	--save "" \
	--appendonly yes \
	--appendfsync always \
	--aclfile /data/users.acl \
	--maxmemory-policy noeviction
