# ==============================================================================
# Makefile — local CD for opencode homelab deployment
#
# This Makefile covers the full local workflow:
#   build images → push to GHCR → update Pulumi config → deploy to cluster
#
# Prerequisites:
#   - Docker (with buildx) installed and running
#   - Node.js installed (for reading package versions)
#   - Pulumi CLI installed  (https://www.pulumi.com/docs/install/)
#   - PULUMI_ACCESS_TOKEN exported in your shell
#   - KUBECONFIG pointing to the homelab cluster
#   - GITHUB_PAT exported (GitHub PAT with write:packages scope for push)
#
# Quickstart:
#   1. make build-push   — build all images and push to GHCR
#   2. make deploy       — update Pulumi config with new tags and deploy
#
# Or all in one:
#   make release
# ==============================================================================

# === CUSTOMIZE THESE ===========================================================
STACK_NAME      ?= dev
GHCR_USER       ?= mrsimpson
HOMELAB_STACK   ?= mrsimpson/homelab/dev
# GITHUB_PAT must be set in your shell (write:packages scope)
# export GITHUB_PAT=ghp_...
# ===============================================================================

# Directory layout (all relative to this Makefile):
#   deployment/homelab/              ← this file lives here (PULUMI_DIR)
#   deployment/opencode-cloudflare-operator/  ← operator source + Dockerfile
#   packages/opencode-router/        ← router source + Dockerfile (monorepo root)
PULUMI_DIR      := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
DEPLOY_DIR      := $(PULUMI_DIR)/..
MONOREPO_ROOT   := $(DEPLOY_DIR)/..

# Derived image names
ROUTER_IMAGE    := ghcr.io/$(GHCR_USER)/opencode-router
OPERATOR_IMAGE  := ghcr.io/$(GHCR_USER)/opencode-cloudflare-operator

# Versions read from package.json files
ROUTER_VERSION   := $(shell node -p "require('$(MONOREPO_ROOT)/packages/opencode-router/package.json').version" 2>/dev/null)
OPERATOR_VERSION := $(shell node -p "require('$(DEPLOY_DIR)/opencode-cloudflare-operator/package.json').version" 2>/dev/null)

# Git short SHA for uniqueness
SHA_SHORT       := $(shell git -C $(MONOREPO_ROOT) rev-parse --short HEAD 2>/dev/null || echo "local")

# Final image tags (matches CI pattern: <version>-<branch>.<sha>)
ROUTER_TAG      := $(ROUTER_VERSION)-local.$(SHA_SHORT)
OPERATOR_TAG    := $(OPERATOR_VERSION)-local.$(SHA_SHORT)

ROUTER_FULL     := $(ROUTER_IMAGE):$(ROUTER_TAG)
OPERATOR_FULL   := $(OPERATOR_IMAGE):$(OPERATOR_TAG)

.PHONY: help build-router build-operator build push-router push-operator push build-push deploy release preview destroy logs

# Default target
help:
	@echo ""
	@echo "opencode homelab — local CD"
	@echo ""
	@echo "Image build targets:"
	@echo "  build-router    Build opencode-router image (linux/amd64)"
	@echo "  build-operator  Build opencode-cloudflare-operator image (linux/amd64)"
	@echo "  build           Build both images"
	@echo "  push-router     Push router image to GHCR (requires GITHUB_PAT)"
	@echo "  push-operator   Push operator image to GHCR (requires GITHUB_PAT)"
	@echo "  push            Push both images"
	@echo "  build-push      Build + push both images"
	@echo ""
	@echo "Deployment targets:"
	@echo "  preview         Pulumi preview (dry-run)"
	@echo "  deploy          Update Pulumi config with current image tags + pulumi up"
	@echo "  release         build-push + deploy"
	@echo "  destroy         Destroy all cluster resources (asks for confirmation)"
	@echo "  logs            Show recent Pulumi stack history"
	@echo ""
	@echo "Active configuration:"
	@echo "  Stack      : $(STACK_NAME)"
	@echo "  GHCR user  : $(GHCR_USER)"
	@echo "  Router     : $(ROUTER_FULL)"
	@echo "  Operator   : $(OPERATOR_FULL)"
	@echo ""

# ------------------------------------------------------------------------------
# Image builds — always target linux/amd64 (homelab cluster is x86_64)
# ------------------------------------------------------------------------------

# Router: build context is monorepo root (Dockerfile references other packages/)
build-router:
	@echo "→ Building $(ROUTER_FULL) ..."
	docker buildx build \
		--platform linux/amd64 \
		--file $(MONOREPO_ROOT)/packages/opencode-router/Dockerfile \
		--tag $(ROUTER_FULL) \
		--tag $(ROUTER_IMAGE):latest \
		--load \
		$(MONOREPO_ROOT)
	@echo "✓ Built $(ROUTER_FULL)"

# Operator: self-contained, build context is deployment/opencode-cloudflare-operator/
build-operator:
	@echo "→ Building $(OPERATOR_FULL) ..."
	docker buildx build \
		--platform linux/amd64 \
		--file $(DEPLOY_DIR)/opencode-cloudflare-operator/Dockerfile \
		--tag $(OPERATOR_FULL) \
		--tag $(OPERATOR_IMAGE):latest \
		--load \
		$(DEPLOY_DIR)/opencode-cloudflare-operator
	@echo "✓ Built $(OPERATOR_FULL)"

build: build-router build-operator

# ------------------------------------------------------------------------------
# Push — requires GITHUB_PAT with write:packages scope
# ------------------------------------------------------------------------------

_ghcr-login:
	@if [ -z "$(GITHUB_PAT)" ]; then \
		echo "✗ GITHUB_PAT is not set. Export a GitHub PAT with write:packages scope:"; \
		echo "  export GITHUB_PAT=ghp_..."; \
		exit 1; \
	fi
	@echo "$(GITHUB_PAT)" | docker login ghcr.io -u $(GHCR_USER) --password-stdin

push-router: _ghcr-login
	@echo "→ Pushing $(ROUTER_FULL) ..."
	docker buildx build \
		--platform linux/amd64 \
		--file $(MONOREPO_ROOT)/packages/opencode-router/Dockerfile \
		--tag $(ROUTER_FULL) \
		--tag $(ROUTER_IMAGE):latest \
		--push \
		$(MONOREPO_ROOT)
	@echo "✓ Pushed $(ROUTER_FULL)"

push-operator: _ghcr-login
	@echo "→ Pushing $(OPERATOR_FULL) ..."
	docker buildx build \
		--platform linux/amd64 \
		--file $(DEPLOY_DIR)/opencode-cloudflare-operator/Dockerfile \
		--tag $(OPERATOR_FULL) \
		--tag $(OPERATOR_IMAGE):latest \
		--push \
		$(DEPLOY_DIR)/opencode-cloudflare-operator
	@echo "✓ Pushed $(OPERATOR_FULL)"

push: push-router push-operator

build-push: build push

# ------------------------------------------------------------------------------
# Pulumi deployment
# ------------------------------------------------------------------------------

# preview — dry-run, no changes applied
preview:
	cd $(PULUMI_DIR) && pulumi preview --stack $(STACK_NAME) --diff

# deploy — updates image config then runs pulumi up
deploy:
	@echo "→ Updating Pulumi image config ..."
	cd $(PULUMI_DIR) && \
		pulumi config set --stack $(STACK_NAME) code:routerImage "$(ROUTER_FULL)" && \
		pulumi config set --stack $(STACK_NAME) code:cfOperatorImage "$(OPERATOR_FULL)"
	@echo "→ Deploying stack $(STACK_NAME) ..."
	cd $(PULUMI_DIR) && pulumi up --stack $(STACK_NAME) --yes
	@echo "✓ Deployed"

# release — the full cycle: build, push, deploy
release: build-push deploy

# destroy — tears down all cluster resources
destroy:
	@echo "WARNING: This will PERMANENTLY destroy all resources in stack '$(STACK_NAME)'."
	@echo "         This cannot be undone."
	@printf "Type the stack name to confirm [$(STACK_NAME)]: " && read ans && [ "$$ans" = "$(STACK_NAME)" ] || (echo "Aborted." && exit 1)
	cd $(PULUMI_DIR) && pulumi destroy --stack $(STACK_NAME)

# logs — recent deployment history
logs:
	cd $(PULUMI_DIR) && pulumi stack history --stack $(STACK_NAME) --page-size 10
