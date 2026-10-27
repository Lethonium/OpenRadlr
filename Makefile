# OpenRadlr — common tasks. Run `make` to see all targets.
#
# Rust and Node are optional on the host: if `cargo` or `npm` is missing,
# the targets run the tools in throwaway Docker containers instead.

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
RUST_IMAGE ?= rust:1-bookworm
NODE_IMAGE ?= node:22-alpine
HEALTH_TIMEOUT ?= 90

# Build number shown in the menu and /api/info (compose passes these as build args).
export OPENRADLR_BUILD_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
export OPENRADLR_BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%MZ)

ifneq ($(shell command -v cargo 2>/dev/null),)
  CARGO := cd server && cargo
else
  CARGO := docker run --rm -t -v "$(CURDIR)":/src -w /src/server -v openradlr-cargo-registry:/usr/local/cargo/registry -v openradlr-cargo-target:/src/server/target $(RUST_IMAGE) sh -c 'rustup component add clippy rustfmt >/dev/null 2>&1; cargo "$$@"' cargo
endif

ifneq ($(shell command -v node 2>/dev/null),)
  NODE := node
else
  NODE := docker run --rm -t -v "$(CURDIR)":/src -w /src $(NODE_IMAGE) node
endif

ifneq ($(shell command -v npm 2>/dev/null),)
  NPM := cd client && npm
else
  NPM := docker run --rm -t -v "$(CURDIR)/client":/app -w /app $(NODE_IMAGE) npm
endif

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n"} \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Run

.PHONY: setup
setup: ## Create .env from .env.example, or add settings that are new there
	@if [ -f .env ]; then sh tools/env-sync.sh .env.example .env; \
	else cp .env.example .env && echo "Created .env — adjust it if needed."; fi

.PHONY: up
up: setup ## Build and start in the background, then wait until healthy
	$(COMPOSE) up -d --build --remove-orphans
	@$(MAKE) --no-print-directory health
	@echo "OpenRadlr is running: http://localhost:$$(grep -E '^OPENRADLR_HTTP_PORT=' .env | cut -d= -f2 | grep . || echo 8080)"

.PHONY: down
down: guard ## Stop and remove the containers (asks first if riders are on; FORCE=1 skips)
	$(COMPOSE) down

.PHONY: restart
restart: guard ## Restart the containers without rebuilding (asks first if riders are on; FORCE=1 skips)
	$(COMPOSE) restart

.PHONY: logs
logs: ## Follow the logs
	$(COMPOSE) logs -f --tail=200

.PHONY: guard
guard: # Ask before dropping riders: used by update, restart and down (FORCE=1 skips it)
	@if [ -n "$(FORCE)" ]; then exit 0; fi; \
	out=$$($(COMPOSE) exec -T server openradlr-server players 2>/dev/null) || { echo "No running server to check for riders — continuing."; exit 0; }; \
	n=$$(printf '%s\n' "$$out" | head -1); \
	case "$$n" in ''|*[!0-9]*) echo "Could not read the rider count — continuing."; exit 0;; esac; \
	[ "$$n" -gt 0 ] || exit 0; \
	where=$$(printf '%s\n' "$$out" | tail -n +2 | awk -F'\t' '{ printf "%s%s on %s", (NR > 1 ? ", " : ""), $$1, $$2 }'); \
	if [ "$$n" -eq 1 ]; then who="1 rider is"; else who="$$n riders are"; fi; \
	echo "$$who on the server right now ($$where)."; \
	echo "This restarts it and drops them."; \
	if [ ! -t 0 ]; then echo "No terminal to ask on: run with FORCE=1 to go ahead anyway."; exit 1; fi; \
	read -r -p "Go ahead anyway? [y/N] " answer; \
	case "$$answer" in y|Y|yes|YES) ;; *) echo "Aborted, nothing changed."; exit 1;; esac

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) ps

.PHONY: health
health: ## Wait until the server reports healthy
	@echo -n "Waiting for the server to become healthy"; \
	for i in $$(seq 1 $(HEALTH_TIMEOUT)); do \
		if $(COMPOSE) exec -T server openradlr-server healthcheck >/dev/null 2>&1; then echo " ok"; exit 0; fi; \
		echo -n "."; sleep 1; \
	done; \
	echo " timed out"; $(COMPOSE) logs --tail=50 server; exit 1

##@ Deploy

.PHONY: update
update: setup guard ## Pull, rebuild and restart (asks first if riders are on; FORCE=1 skips)
	@if [ -n "$$(git status --porcelain --untracked-files=no)" ]; then \
		echo "Local changes found — commit or stash them before updating."; exit 1; fi
	git pull --ff-only
	@$(MAKE) --no-print-directory setup
	$(COMPOSE) build --pull
	$(COMPOSE) up -d --remove-orphans
	@$(MAKE) --no-print-directory health
	docker image prune -f >/dev/null
	@echo "Updated to $$(git rev-parse --short HEAD)."

.PHONY: build
build: ## Build the Docker image without starting it
	$(COMPOSE) build --pull

##@ Develop

.PHONY: dev
dev: ## Run the server locally with cargo on http://localhost:8080 (reads .env.dev, Strava keys from .env)
	cd server && set -a && { [ ! -f ../.env.dev ] || . ../.env.dev; } && \
		{ [ -n "$${OPENRADLR_STRAVA_CLIENT_ID:-}" ] || [ ! -f ../.env ] || eval "$$(grep -E '^OPENRADLR_STRAVA_CLIENT_(ID|SECRET)=' ../.env)"; } && \
		{ [ -z "$${OPENRADLR_STRAVA_CLIENT_ID:-}" ] || OPENRADLR_PUBLIC_URL="$${OPENRADLR_PUBLIC_URL:-http://localhost:8080}"; } && set +a && \
		OPENRADLR_STATIC_DIR=../client/public OPENRADLR_ROUTE_FILE=../routes/rolling-hills.json \
		OPENRADLR_BIND=127.0.0.1:8080 RUST_LOG=$${RUST_LOG:-info,openradlr_server=debug} cargo run --bin openradlr-server

.PHONY: test
test: test-server test-client ## Run all tests

.PHONY: test-server
test-server: ## Run the Rust tests (simulation, server, end-to-end)
	$(CARGO) test --workspace

.PHONY: test-client
test-client: ## Run the browser client tests
	$(NPM) test

.PHONY: lint
lint: lint-server lint-client ## Check formatting and lints

.PHONY: lint-server
lint-server: ## rustfmt check and clippy with warnings as errors
	$(CARGO) fmt --all -- --check
	$(CARGO) clippy --workspace --all-targets -- -D warnings

.PHONY: lint-client
lint-client: client/node_modules ## ESLint for the browser client
	$(NPM) run lint

.PHONY: screenshot
screenshot: client/node_modules ## Screenshot of the running client (start it first, e.g. `make dev`; pass ARGS="--out shot.png")
	$(NPM) run screenshot -- $(ARGS)

client/node_modules: client/package.json
	$(NPM) install --no-audit --no-fund
	@touch $@

.PHONY: fmt
fmt: ## Format the Rust code
	$(CARGO) fmt --all

.PHONY: check
check: lint test ## Everything CI runs

.PHONY: routes
routes: ## Regenerate the bundled map's road network and routes (tools/valley-map.mjs)
	$(NODE) tools/valley-map.mjs

.PHONY: lock
lock: ## Create or refresh server/Cargo.lock (commit it afterwards)
	$(CARGO) generate-lockfile

.PHONY: clean
clean: ## Remove build output and local dependencies
	rm -rf server/target client/node_modules
