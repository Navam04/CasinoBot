#!/bin/sh
set -eu

npx prisma migrate deploy
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node dist/src/index.js
