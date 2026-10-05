FROM node:24-bookworm-slim AS node
FROM ghcr.io/astral-sh/uv:0.8.22 AS uv
FROM python:3.14-bookworm

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=uv /uv /usr/local/bin/uv
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update \
    && apt-get install -y --no-install-recommends git cron redis-server mariadb-client \
       libmariadb-dev pkg-config gettext libpango-1.0-0 libharfbuzz0b \
       libpangoft2-1.0-0 libffi-dev libssl-dev libldap2-dev libsasl2-dev \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g yarn@1.22.22 \
    && uv pip install --system frappe-bench honcho \
    && useradd -m -u 1000 frappe \
    && mkdir -p /workspace \
    && chown frappe:frappe /workspace

USER frappe
WORKDIR /workspace
ENV UV_PYTHON=3.14
CMD ["bash", "/src/statistics_diy/scripts/dev-bench.sh"]
