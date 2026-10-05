# Statistics DIY

Self-hosted website and app analytics for independent developers.

**Your websites. Your apps. Your statistics.**

Project domain: `statistics.diy`

## One-line installation

On Linux or macOS with **Docker running and Docker Compose v2 installed**:

```bash
curl -fsSL https://raw.githubusercontent.com/scyllarusllc/statistics.diy/main/install.sh | bash
```

This builds and starts Frappe version 16, MariaDB, Redis, workers, and Statistics DIY in a dedicated Docker Compose stack. It creates the `statistics.localhost` site and installs `statistics_diy`; no existing Bench is modified. Docker itself is a prerequisite and is not installed by this script.

Open **http://localhost:8080** and sign in as **Administrator**. The generated password is the `ADMIN_PASSWORD` value in `~/.local/share/statistics-diy/.env`. This file is created with private permissions; it is preserved on retries. The installation currently opens the Frappe login/Desk, not a finished analytics dashboard.

The initial image build can take several minutes and requires enough disk space for the Frappe build and its containers. Docker must support BuildKit secrets. The build uses a [pinned official Frappe Docker recipe](https://github.com/frappe/frappe_docker/tree/f71a386bc13f75dcc0cf7462f025f531576a04fc); Frappe's `version-16` branch and the app's `main` branch track their current code.

To choose a different port and installation directory:

```bash
curl -fsSL https://raw.githubusercontent.com/scyllarusllc/statistics.diy/main/install.sh | STATISTICS_DIY_PORT=8081 STATISTICS_DIY_DIR="$HOME/statistics-diy-server" bash
```

These settings apply on first installation. Reruns reuse the existing `.env` and persistent database/site volumes. The installer manages one stack named `statistics-diy` per Docker daemon. It does not support multiple instances or upgrades of established deployments yet. If an installation is interrupted, rerun the same command; do not delete database volumes to retry.

Manage the default installation:

```bash
cd ~/.local/share/statistics-diy
docker compose ps
docker compose logs --tail=100
docker compose stop
docker compose start
```

The web port binds to localhost. Public deployment requires a reverse proxy with HTTPS, appropriate host/proxy settings, and a backup plan. Domain hosting and TLS are not configured by this installer.

## Status

`statistics_diy` is an independent Frappe app. The first website analytics slice includes projects, page-view collection, a tracking script and a basic Desk report. App analytics and advanced reporting remain to be implemented.

## Why this project exists

Independent developers often maintain both a website and a desktop or mobile app. Statistics DIY aims to bring website traffic and app usage into one simple dashboard that developers can run on their own infrastructure.

The initial idea comes from the website and app analytics features in VibeCMS. Those features provide useful experience with collection and presentation, while this project will define its own independent data model and deployment workflow.

Existing projects such as [Umami](https://docs.umami.is/docs/about) and [Plausible](https://plausible.io/open-source-website-analytics) already offer self-hosted website analytics. Statistics DIY will focus on a small, understandable experience that combines websites and apps.

## First release scope

### Website analytics

- Page views and unique visitor estimates.
- Popular pages and referral sources.
- Country, browser, operating system, and device breakdowns.
- Daily trends with explicit reporting timezone and retention boundaries.
- Integration through a lightweight JavaScript snippet.

### App analytics

- First-seen anonymous installs, rather than an unverifiable count of all installations.
- Daily and monthly active installs based on recorded activity.
- App version, operating system, and release bundle breakdowns.
- Ping counts within the selected reporting period.
- Integration through a documented HTTP endpoint suitable for desktop and mobile apps.

### Project management and deployment

- Multiple websites and apps in one instance.
- Project-scoped collection credentials and isolated reporting data.
- Administrator authentication and project access controls.
- One-line Docker installation or installation on an existing Frappe Bench.
- Setup documentation and synthetic demonstration data.

Session replay, experiments, advertising attribution, and payment processing are outside the first release scope.

## Data accuracy principles

1. Store timestamped events or daily activity records. A mutable `last_seen` field alone cannot reconstruct historical daily activity.
2. Define DAU as distinct installs active during a calendar day in the reporting timezone. Label rolling 24-hour activity separately.
3. Define MAU as distinct installs active within a documented 30-day window. Counts of installs are not counts of people.
4. Calculate period ping totals from activity within that period, not lifetime counters of currently active installs.
5. Separate website visitor estimates from app install identities. Avoid presenting either as an exact count of people.
6. Distinguish missing or expired data from observed zero activity. Charts must show the available retention window.
7. Keep project identity on all events, activity records, aggregates, and reporting queries.
8. Support retries and deduplication so repeated submissions do not silently inflate statistics.

## Privacy direction

- Avoid persistent browser fingerprinting by default.
- Avoid retaining raw IP addresses by default. If country lookup is enabled, use request IPs transiently and store only the necessary coarse location.
- Use client-generated, resettable anonymous install IDs for optional app analytics.
- Respect website tracking opt-out settings and document collection behavior.
- Document how website unique visitor estimates are calculated and their limitations before implementation.
- Keep credentials, production data, and identifiable sample data out of the repository.

Exact collection defaults and retention periods will be documented as the implementation develops.

## Version-one architecture

- **Framework:** Frappe, as a standalone app with no dependency on VibeCMS or ERPNext.
- **App/package name:** `statistics_diy`, avoiding a collision with Python's standard-library `statistics` module.
- **Collector:** Frappe HTTP endpoints accepting website and app events through a documented, framework-neutral protocol.
- **Database:** the database supported by the target Frappe Bench, initially MariaDB in the existing development environment. PostgreSQL is not a version-one requirement.
- **Data model:** project-scoped DocTypes for projects, events, anonymous installs, daily activity, and reporting aggregates. Detailed schemas remain to be implemented.
- **Dashboard:** Frappe-backed analytics pages with authentication and project access controls.
- **Background work:** Frappe queues and scheduler for aggregation and retention tasks.
- **Deployment:** the one-line Docker installer, or an existing Frappe Bench.

Frappe supplies the initial application foundation, permissions, migrations, and background jobs. Collection clients do not need Frappe: ordinary websites and desktop/mobile apps will submit events over HTTP. VibeCMS will be one such client.

Keep collection validation and aggregation logic separate from page rendering and framework adapters. Frequently refreshed dashboards should use bounded queries and appropriate aggregates instead of recalculating every report on every refresh.

A separate collector or analytics database can be introduced later if measured traffic and query performance justify it. This is an extension path, not a first-release requirement.

## Install the app skeleton

### Local development with Make

With Docker running and Docker Compose v2 installed:

```bash
make dev
```

The first run builds a development image with Python 3.14, Node 24, Yarn,
Redis, and Bench, initializes a separate Frappe `version-16` Bench, creates
`statistics.localhost`, installs this checkout, enables developer mode, and
finally runs `bench start` in the foreground inside the container. The current
source directory is mounted and linked into Bench so edits use your local code.
The version requirements follow the [Frappe installation guide](https://docs.frappe.io/framework/user/en/installation).
Docker itself must already be installed and accessible to your user.

Open **http://localhost:8000** and log in as **Administrator** with password
**statistics-dev-admin**. These fixed credentials are only for local development;
the web and Socket.IO ports bind to localhost and the database has no published
port. Open `/app/analytics` in Frappe Desk for the initial page-view report.

Press Ctrl+C to stop Bench. Rerun `make dev` to reuse the Bench, site, and database
stored in Docker volumes. Run `make dev-stop` to stop the development stack while
preserving those volumes. This uses a separate Compose project from `install.sh`.
Do not run two `make dev` sessions at once. On Linux, files generated in the
mounted checkout belong to container UID 1000; your user may need to adjust their
ownership before editing them.

To use different host ports:

```bash
STATISTICS_DIY_DEV_PORT=8001 STATISTICS_DIY_DEV_SOCKETIO_PORT=9001 make dev
```

First-time setup requires network access and can take several minutes. If setup
fails, `bench start` is not run; retry after resolving the reported error. An
incomplete initial Bench clone or virtual environment requires inspection of the
development volume before retrying; the script does not delete existing data.

### Existing Bench

From an existing, compatible Frappe Bench, install this local checkout:

```bash
bench get-app /absolute/path/to/statistics.diy
bench --site your-site.example install-app statistics_diy
bench --site your-site.example list-apps
```

For this checkout, the local path is `~/github/statistics.diy`. Use a development site for the initial installation. Installing the skeleton registers the app and its module; it does not provide analytics features yet.

The package requires Python 3.10 or newer. The selected Frappe release may require a newer Python version. A supported Frappe version matrix will be published after installation and migration checks on a development site.

## Development roadmap

1. Specify event schemas, anonymous identities, project isolation, metric definitions, and retention rules.
2. Implement Frappe DocTypes and collection endpoints with validation, rate limiting, and retry deduplication.
3. Add the website snippet and an app integration example.
4. Build dashboards for website traffic and app activity with correct historical trends.
5. Configure Frappe roles and project permissions; add deployment instructions, migrations, and synthetic demo data.
6. Validate using the Pomatez website and app, without publishing their production analytics.
7. Publish the first open-source release once deployment and metric accuracy are verified.

## Development checks

Meaningful verification should cover project isolation, event validation, retry behavior, timezone boundaries, daily/monthly distinct counts, retention boundaries, and period ping totals.

The app is installed on the development Frappe site. The analytics integration verification command is documented below.

Installer contract checks can be run without Docker:

```bash
python3 -m unittest discover -s tests -v
bash -n install.sh
```

These tests simulate downloads and Docker commands. They verify installation order, private credential files, retries, and input validation; they do not validate a running Frappe deployment. A full Docker build and site startup have not yet been verified.

## License

MIT is the proposed license. A license file and copyright attribution will be added before the first public release, after confirming ownership and any reused code licenses.

## First analytics workflow

The app now includes **Analytics Project**, **Analytics Event**, a page-view tracker,
and a Desk page at `/app/analytics` (System Manager access).

1. Open `/app/analytics` and select **Create Project**.
2. Enter the project name and exact website origin, e.g. `https://example.com`.
3. Save and copy **Tracking Snippet** into the website's HTML.
4. Choose the project on `/app/analytics` to see page views, daily totals and top paths.

The current snippet uses `https://statistics.diy` as the collector host. For another
installation, adjust the script URL. Collection keys are public project identifiers,
not secrets. Origin checks discourage accidental cross-project submissions but do
not authenticate arbitrary HTTP clients or prevent forged analytics.

This first slice records server receipt time in UTC, pathname and referrer hostname.
It does not store IP addresses, query strings, visitor identifiers or cookies. The
tracker honors browser Do Not Track. It tracks initial document loads; SPA navigation,
unique visitors, app activity, country/device reports and automated retention are not
implemented. Reports cover a rolling 30-day window; events currently remain stored
until explicitly deleted. Collection is capped at 1,000 requests per project per minute.

Apply schema and asset changes in a Bench using:

```bash
bench --site statistics.localhost migrate
bench build --app statistics_diy
```

Integration verification creates temporary projects and events and removes them:

```bash
bench --site statistics.localhost execute statistics_diy.verify.run
```

This verification includes an HTTP request through `https://statistics.diy`; adapt
that URL when validating another deployment.
