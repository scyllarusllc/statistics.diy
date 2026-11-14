.PHONY: dev test css

# Needs Node.js 22.13+ for the built-in node:sqlite. If the default node is older (or lacks it),
# fetch Node 24 through npm on first use. Dependencies are installed first in either case.
dev:
	@if node -e "require('node:sqlite')" >/dev/null 2>&1; then \
		npm install && node --watch --no-warnings=ExperimentalWarning server.mjs; \
	else \
		echo "node:sqlite not available in $$(node --version); using Node.js 24 (first run downloads it)."; \
		npm exec --yes --package=node@24 -- sh -c 'npm install && node --watch --no-warnings=ExperimentalWarning server.mjs'; \
	fi

test:
	@if node -e "require('node:sqlite')" >/dev/null 2>&1; then \
		npm test; \
	else \
		npm exec --yes --package=node@24 -- sh -c 'npm install && npm test'; \
	fi

css:
	npm run build:css
