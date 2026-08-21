# Production operations

**Never run `docker compose` directly against production for an ad hoc
operation** (restarting a service, `--force-recreate`, stopping/starting
anything, changing env vars and reloading a container - anything that isn't
a full run of `scripts/deploy.sh`). Always use:

```bash
bash scripts/docker-compose-prod.sh <normal docker compose args>
```

instead of `docker compose -f docker-compose.prod.yml <args>` directly on
the server. It transparently detects whether `backend`'s container identity
changed (for any reason - not just ones already anticipated) and restarts
`nginx` automatically when it did, then runs a real public smoke test
(an actual HTTPS request through nginx to `https://theke.ai/login` and a
deliberately-wrong-credentials POST to `/api/auth/login`, checked for a
genuine `401`) before considering the operation done.

**Why this is a hard rule, not a preference:** a raw `docker compose ...
--force-recreate scheduler crawler` run outside `scripts/deploy.sh` caused a
real ~3h20m production login outage on 2026-08-21 - it silently recreated
`backend` too (Compose detected `.env` content had drifted for that service
as well), giving it a new internal Docker IP that `nginx` never re-resolved
because nothing restarted it afterward. `backend`'s own `/health` endpoint
reported healthy the entire time - the break was only in nginx's path *to*
it, which an internal health check can never catch. Full incident writeup
and root cause: `KNOWN_DECISIONS.md`, "Real production outage" entry.

`scripts/deploy.sh` itself is already safe (it restarts `nginx`
unconditionally on every run, and ends with the same real public smoke
test) - this rule is specifically for anything run outside it.
