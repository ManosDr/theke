# theke

Theke is a Greek regulatory intelligence platform for two professional
verticals: **construction permitting** and **tax & accounting**. Users ask
questions in plain Greek (or English) and get answers grounded in official
sources - ΦΕΚ, Ν.4495/2017, ΤΕΕ, ΥΠΕΝ, ΑΑΔΕ, e-ΕΦΚΑ, Κτηματολόγιο, ΚΦΕ/ΚΦΔ -
with numbered citations back to the source document, never a bare LLM
completion with no grounding.

Companies sign up under one vertical and get a scoped knowledge base, chat
assistant, document search, and (for construction) a project/customer
management layer with map-based plot lookup (KAEK, address, or pin), a
cadastral parcel lookup against the official Κτηματολόγιο FeatureServer, and
archaeological-zone proximity flagging. A super admin manages tenants, the
public knowledge base, and per-vertical configuration across both verticals
from a dedicated admin surface.

## Architecture

- **Backend**: FastAPI (Python), PostgreSQL with the pgvector extension,
  Redis (rate limiting), OpenAI GPT-4o (chat generation) and
  text-embedding-3-small (retrieval embeddings)
- **Frontend**: Next.js, bilingual (English/Greek, admin-extensible),
  light/dark theme
- **Infrastructure**: Docker Compose for local development;
  Nginx + a Hetzner VPS for production (see `infra/nginx.conf`)
- **External services**: ArcGIS FeatureServer (cadastral parcel lookup by
  KAEK or point-in-polygon), Nominatim (geocoding), the Ktimatologio viewer
  (parcel detail links)

## Setup (development)

1. Clone the repository.
2. Copy the environment template and fill in real values:
   ```bash
   cp .env.example .env
   ```
   At minimum, set `OPENAI_API_KEY`, `JWT_SECRET`, and (optional but
   recommended for local dev) `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` to
   bootstrap a platform super admin on first startup. Set
   `ENVIRONMENT=development` and `SEED_DEMO_DATA=true` for local work -
   `.env.example` ships with production-oriented defaults since it also
   serves as the reference for a real deployment.
3. Start the stack:
   ```bash
   docker compose up --build
   ```
4. The app runs at `http://localhost:3000`; the API is at
   `http://localhost:8000` (`/health` for a quick check).

With `SEED_DEMO_DATA=true`, seven fixed demo accounts are created on first
startup (password `demo1234` for all), one per role/vertical combination:

| Email | Role | Vertical |
|---|---|---|
| `demo-superadmin@theke.gr` | Platform super admin | — |
| `demo-admin@construction.theke.gr` | Company admin | Construction |
| `demo-member@construction.theke.gr` | Company member | Construction |
| `demo-admin@municipality.theke.gr` | Company admin | Construction (municipality) |
| `demo-member@municipality.theke.gr` | Company member | Construction (municipality) |
| `demo-admin@accounting.theke.gr` | Company admin | Tax & Accounting |
| `demo-member@accounting.theke.gr` | Company member | Tax & Accounting |

Log in with the password above, or - once logged in as the super admin -
use "View as" on the Χρήστες admin screen to switch into any user's view
without their password (see KNOWN_DECISIONS.md). The public login page no
longer has a demo-account picker; that was fine pre-launch when every
account was a demo account, but not once real customer invites go out.

The crawler doesn't need to be started manually - `docker compose up` also
starts a `scheduler` service that runs it monthly via supercronic. To
trigger an ingestion run on demand:

```bash
docker compose --profile crawler run --rm crawler
```

## Running tests

```bash
docker exec theke-backend-1 python -m pytest tests/ -v
```

One test is marked `skip` (documented LLM non-determinism in the off-topic
guard classifier, not a flaky assertion) - every other test should pass.

## Production deployment

Production uses `docker-compose.prod.yml` (no bind mounts, code baked into
images, an `nginx` service in front terminating SSL and reverse-proxying to
the frontend/backend - see `infra/nginx.conf`) and `scripts/deploy.sh`,
which pulls `main`, rebuilds, reapplies `db/init.sql`, and polls `/health`
before declaring success. The full deployment checklist and the reasoning
behind specific production choices (no Alembic, SSL bootstrap order, etc.)
are in [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md).

## Key decisions and known limitations

See [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md) for judgment calls made along
the way - deliberate trade-offs, not oversights, each with the reasoning
and the condition under which it's worth revisiting - and
[CAPABILITIES.md](CAPABILITIES.md) for a plain-language inventory of what
the app actually does and doesn't do today.
