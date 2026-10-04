# Statistics DIY

Self-hosted website and app analytics for independent developers.

**Your websites. Your apps. Your statistics.**

Project domain: `statistics.diy`

## Status

Version one will be an independent Frappe app named `statistics_diy`. This repository contains its packaging and application skeleton. Analytics DocTypes, collection endpoints, dashboards, SDKs, and deployment configuration are not implemented yet.

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
- Installation on an existing Frappe Bench; a documented container deployment is planned.
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
- **Deployment:** an existing Frappe Bench initially, with container deployment documentation planned.

Frappe supplies the initial application foundation, permissions, migrations, and background jobs. Collection clients do not need Frappe: ordinary websites and desktop/mobile apps will submit events over HTTP. VibeCMS will be one such client.

Keep collection validation and aggregation logic separate from page rendering and framework adapters. Frequently refreshed dashboards should use bounded queries and appropriate aggregates instead of recalculating every report on every refresh.

A separate collector or analytics database can be introduced later if measured traffic and query performance justify it. This is an extension path, not a first-release requirement.

## Install the app skeleton

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

The app skeleton has not yet been installed on a Frappe site. Analytics tests and their execution commands will be added with the implementation.

## License

MIT is the proposed license. A license file and copyright attribution will be added before the first public release, after confirming ownership and any reused code licenses.
