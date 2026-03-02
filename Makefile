.PHONY: help dev setup conductor forward patch-agent

# GitHub App Configuration
export GITHUB_APP_ID         ?= 2920581
export GITHUB_INSTALLATION_ID ?= 111664943
export GITHUB_WEBHOOK_SECRET ?= whs_t1ls3y_4g3nts_l0c4l
export PORT                  ?= 3000

export COPILOT_GITHUB_TOKEN  ?= $(GITHUB_TOKEN)

# Load .env if it exists (overrides above defaults)
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

help:
	@echo "tilsley/agents — Makefile targets:"
	@echo ""
	@echo "  make dev             Start conductor + UI (Ctrl+C to stop both)"
	@echo "  make setup           Install dependencies (gh-webhook extension, snyk CLI)"
	@echo "  make conductor       Start the conductor webhook server only (port $${PORT})"
	@echo "  make forward         Forward GitHub webhooks to the local conductor"
	@echo "  make patch-agent     Scan TARGET_REPO for vulns and open a patch PR"
	@echo ""
	@echo "First time? Run: make setup"
	@echo ""
	@echo "Required files:"
	@echo "  conductor.pem        GitHub App private key (download from app settings)"
	@echo ""
	@echo "Required env vars (add to .env or export):"
	@echo "  GITHUB_TOKEN         Personal access token (used for patch-agent + Copilot)"
	@echo "  SNYK_TOKEN           Snyk token for patch-agent (https://app.snyk.io/account)"
	@echo "  TARGET_OWNER         Repo owner for patch-agent (e.g. tilsley)"
	@echo "  TARGET_REPO          Repo name for patch-agent (e.g. create-react-app-auth-amplify)"

dev:
	@./dev.sh

setup:
	@echo "==> Installing dependencies..."
	@echo ""
	@echo "--- gh-webhook extension ---"
	@if gh webhook forward --help > /dev/null 2>&1; then \
		echo "✓ gh-webhook already installed"; \
	else \
		echo "Installing cli/gh-webhook..."; \
		gh extension install cli/gh-webhook; \
		echo "✓ gh-webhook installed"; \
	fi
	@echo ""
	@echo "--- snyk CLI ---"
	@if which snyk > /dev/null 2>&1; then \
		echo "✓ snyk already installed ($$(snyk --version))"; \
	else \
		echo "Installing snyk..."; \
		npm install -g snyk; \
		echo "✓ snyk installed"; \
	fi
	@echo ""
	@echo "✓ Setup complete"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env and fill in GITHUB_TOKEN and SNYK_TOKEN"
	@echo "  2. Download your GitHub App private key and save as ./conductor.pem"

conductor:
	@if [ -z "$$GITHUB_TOKEN" ]; then \
		echo "Error: GITHUB_TOKEN not set. Add to .env or export it."; \
		exit 1; \
	fi
	@if [ ! -f conductor.pem ]; then \
		echo "Error: conductor.pem not found."; \
		echo "Download your GitHub App private key and save it as ./conductor.pem"; \
		exit 1; \
	fi
	@echo "✓ Configuration loaded"
	@echo "  GitHub App ID:      $$GITHUB_APP_ID"
	@echo "  Installation ID:    $$GITHUB_INSTALLATION_ID"
	@echo "  Webhook Secret:     $$GITHUB_WEBHOOK_SECRET"
	@echo "  Port:               $$PORT"
	@echo ""
	GITHUB_PRIVATE_KEY="$$(cat conductor.pem)" bun run apps/conductor/src/main.ts

forward:
	@if ! gh webhook forward --help > /dev/null 2>&1; then \
		echo "Error: gh-webhook extension not installed. Run: make setup"; \
		exit 1; \
	fi
	@if [ -z "$$FORWARD_REPO" ]; then \
		echo "Error: FORWARD_REPO not set (e.g. make forward FORWARD_REPO=tilsley/my-repo)"; \
		exit 1; \
	fi
	gh webhook forward \
		--repo="$$FORWARD_REPO" \
		--events=pull_request,check_run \
		--url=http://localhost:$$PORT/webhook \
		--secret="$$GITHUB_WEBHOOK_SECRET"

patch-agent:
	@if [ -z "$$GITHUB_TOKEN" ]; then \
		echo "Error: GITHUB_TOKEN not set."; \
		exit 1; \
	fi
	@if [ -z "$$SNYK_TOKEN" ]; then \
		echo "Error: SNYK_TOKEN not set."; \
		exit 1; \
	fi
	@if [ -z "$$TARGET_REPO" ]; then \
		echo "Error: TARGET_REPO not set (e.g. make patch-agent TARGET_REPO=my-repo TARGET_OWNER=tilsley)"; \
		exit 1; \
	fi
	GITHUB_TOKEN="$$GITHUB_TOKEN" \
	SNYK_TOKEN="$$SNYK_TOKEN" \
	TARGET_OWNER="$${TARGET_OWNER:-tilsley}" \
	TARGET_REPO="$$TARGET_REPO" \
	MIN_SEVERITY="$${MIN_SEVERITY:-high}" \
	bun run agents/patch-agent/src/main.ts
