# =============================================================================
# Sage PocketBase CI/CD Framework
# =============================================================================
# Provider-agnostic build/deploy system following the Sage-is-AI CI/CD pattern.
#
# Runs on: Linux, macOS, Windows (WSL)
# Requires: make, bash, git, container runtime (podman or docker)
#
# Quick start:
#   make it_build       — build container image
#   make it_run         — run the container
#   make it_build_n_run — build + run
#   make help           — list all targets
# =============================================================================

# Load environment variables from .env if it exists
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

# Auto-detect container runtime (prefer podman, fall back to docker)
CONTAINER_RUNTIME ?= $(shell command -v podman 2>/dev/null || echo docker)

# Derive org/repo from git remote (e.g. git@github.com:Sage-is/DB-sage-pb.git -> sage-is/db-sage-pb)
GIT_REPO_SLUG := $(shell git remote get-url origin 2>/dev/null | sed -E 's|\.git$$||; s|.*[:/]([^/]+/[^/]+)$$|\1|' | tr '[:upper:]' '[:lower:]')

# Configuration variables with defaults (override with .env file)
IMAGE_NAME ?= $(GIT_REPO_SLUG)
GHCR_IMAGE_NAME ?= ghcr.io/$(GIT_REPO_SLUG)
GIT_TAG := $(shell git tag --sort=-v:refname | sed 's/^v//' | head -n 1)
IMAGE_TAG := $(if $(GIT_TAG),$(GIT_TAG),latest)
GIT_BRANCH := $(shell git rev-parse --abbrev-ref HEAD)
ifeq ($(GIT_BRANCH),HEAD)
    GIT_BRANCH := $(shell git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
endif
SAFE_GIT_BRANCH := $(subst /,-,$(GIT_BRANCH))
SAFE_GIT_BRANCH := $(shell echo $(SAFE_GIT_BRANCH) | tr '[:upper:]' '[:lower:]')
CONTAINER_NAME ?= $(shell echo $(GIT_REPO_SLUG) | tr '/' '-')
PORT_MAPPING ?= 8090:8090
VOLUME_DATA ?= sage-pb-data:/app/pb_data

# Release version detection (prefers release/* branch name, falls back to latest tag)
RELEASE_VERSION := $(shell git rev-parse --abbrev-ref HEAD | sed -n 's/^release\///p')
ifeq ($(RELEASE_VERSION),)
	RELEASE_VERSION := $(GIT_TAG)
endif

# PocketBase version (override via .env or CLI: make it_build PB_VERSION=0.36.8)
PB_VERSION ?= 0.36.8

help:
	@echo "======================================================="
	@echo "  $(IMAGE_NAME) — Sage PocketBase"
	@echo ""
	@echo "Usage examples:"
	@echo "  1) Build:          make it_build"
	@echo "  2) Run:            make it_run"
	@echo "  3) Build + Run:    make it_build_n_run"
	@echo "  4) Push to GHCR:   make it_build_multi_arch_push_GHCR"
	@echo ""
	@echo "Available make commands:"
	@echo ""
	@LC_ALL=C $(MAKE) -pRrq -f $(firstword $(MAKEFILE_LIST)) : 2>/dev/null \
		| awk -v RS= -F: '/(^|\n)# Files(\n|$$)/,/(^|\n)# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | grep -E -v -e '^[^[:alnum:]]' -e '^$$@$$'
	@echo ""

# ---------------------------------------------------------------------------
# Common docker run arguments
# ---------------------------------------------------------------------------
DOCKER_RUN_ENV_ARGS :=
ifdef RESEND_API_KEY
DOCKER_RUN_ENV_ARGS += -e RESEND_API_KEY=$(RESEND_API_KEY)
endif

DOCKER_RUN_ARGS := --rm -p $(PORT_MAPPING) \
	-v $(VOLUME_DATA) \
	$(DOCKER_RUN_ENV_ARGS) \
	--name $(CONTAINER_NAME)

# ---------------------------------------------------------------------------
# Container lifecycle
# ---------------------------------------------------------------------------
it_stop:
	$(CONTAINER_RUNTIME) rm -f $(CONTAINER_NAME)

it_clean:
	$(CONTAINER_RUNTIME) system prune -f
	$(CONTAINER_RUNTIME) builder prune --force
	@echo ""

it_gone:
	@echo "Forcefully stopping and removing $(CONTAINER_NAME)..."
	$(CONTAINER_RUNTIME) stop $(CONTAINER_NAME) || true
	$(CONTAINER_RUNTIME) rm -f $(CONTAINER_NAME) || true
	@echo "Container $(CONTAINER_NAME) has been removed"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
it_build:
	@echo "Building Docker image with BuildKit enabled..."
	@export DOCKER_BUILDKIT=1 && \
	$(CONTAINER_RUNTIME) build --load \
		--build-arg PB_VERSION=$(PB_VERSION) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		-t $(IMAGE_NAME):$(IMAGE_TAG)-$(SAFE_GIT_BRANCH) \
		-t $(IMAGE_NAME):$(SAFE_GIT_BRANCH) \
		.
	@echo ""

it_build_no_cache:
	@echo "Building Docker image without cache..."
	@export DOCKER_BUILDKIT=1 && \
	$(CONTAINER_RUNTIME) build --no-cache --load \
		--build-arg PB_VERSION=$(PB_VERSION) \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		-t $(IMAGE_NAME):$(IMAGE_TAG)-$(SAFE_GIT_BRANCH) \
		-t $(IMAGE_NAME):$(SAFE_GIT_BRANCH) \
		.
	@echo ""

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
it_run:
	$(CONTAINER_RUNTIME) run $(DOCKER_RUN_ARGS) $(IMAGE_NAME):$(IMAGE_TAG)

it_run_ghcr:
	$(CONTAINER_RUNTIME) run $(DOCKER_RUN_ARGS) $(GHCR_IMAGE_NAME):$(IMAGE_TAG)

# Combined build and run
it_build_n_run: it_build
	@make it_run

it_build_n_run_no_cache: it_build_no_cache
	@make it_run

# Run generic image with bind-mounted hooks/migrations/public for local dev
it_run_dev:
	$(CONTAINER_RUNTIME) run --rm -p $(PORT_MAPPING) \
		-v $(VOLUME_DATA) \
		-v $$(pwd)/pb_hooks:/app/pb_hooks:ro \
		-v $$(pwd)/pb_migrations:/app/pb_migrations:ro \
		-v $$(pwd)/pb_public:/app/pb_public:ro \
		$(DOCKER_RUN_ENV_ARGS) \
		--name $(CONTAINER_NAME) \
		$(IMAGE_NAME):$(IMAGE_TAG) \
		pocketbase serve --http=0.0.0.0:8090 --dir=/app/pb_data --hooksDir=/app/pb_hooks --migrationsDir=/app/pb_migrations --publicDir=/app/pb_public

# Build and run with a throwaway volume (fresh-install test)
it_build_n_test_fresh: it_build
	@echo "Running with fresh test volume (sage-pb-test-data)..."
	-$(CONTAINER_RUNTIME) run --rm -p $(PORT_MAPPING) -v sage-pb-test-data:/app/pb_data $(IMAGE_NAME):latest
	-$(CONTAINER_RUNTIME) volume rm sage-pb-test-data 2>/dev/null || true
	@echo "Test volume cleaned up."

# ---------------------------------------------------------------------------
# Test harness (auto-creates superuser, submits test order, checks emails)
# ---------------------------------------------------------------------------
test:
	./scripts/test.sh --keep

test_fresh:
	./scripts/test.sh --fresh --keep

# ---------------------------------------------------------------------------
# GHCR (GitHub Container Registry)
# ---------------------------------------------------------------------------
ghcr_login:
	@echo "=== Logging into GHCR via gh CLI ==="
	@gh auth status >/dev/null 2>&1 || { echo "Error: gh CLI not authenticated. Run: gh auth login"; exit 1; }
	@gh auth token | docker login ghcr.io -u $$(gh api user -q .login) --password-stdin
	@echo "Logged into ghcr.io as $$(gh api user -q .login)"
	@echo ""
	@echo "If push is denied, ensure your token has write:packages scope:"
	@echo "  gh auth refresh -s write:packages"

# Ensure buildx builder exists
ensure_builder:
	@docker buildx inspect multi-arch-builder >/dev/null 2>&1 || docker buildx create --name multi-arch-builder --use

# Multi-architecture build+push helper
define build_multi_arch
	@make it_clean
	@make ensure_builder
	docker buildx build --platform linux/amd64,linux/arm64 \
		--build-arg PB_VERSION=$(PB_VERSION) \
		-t $(1):$(IMAGE_TAG) \
		-t $(1):latest \
		--push .
endef

# Deploy to CapRover
it_deploy:
	caprover deploy --default

it_build_multi_arch_push_GHCR: ghcr_login
	@echo "Building multi-arch and pushing to GHCR"
	$(call build_multi_arch,$(GHCR_IMAGE_NAME))
	@echo "Completed GHCR multi-arch push for version $(IMAGE_TAG)"

# ---------------------------------------------------------------------------
# Version / Release (git-flow)
# ---------------------------------------------------------------------------
show_version:
	@echo "Current version: $(IMAGE_TAG)"

bump_release_version:
	@if [ -z "$(RELEASE_VERSION)" ]; then \
		echo "Error: RELEASE_VERSION not defined. Are you on a release/ or hotfix/ branch?"; \
		exit 1; \
	fi
	@echo "Bumping version to $(RELEASE_VERSION)..."
	@python3 -c "import re; f='README.md'; ver='$(RELEASE_VERSION)'.lstrip('v'); c=open(f).read(); n=re.sub(r'^## v.*', f'## v{ver}', c, count=1, flags=re.MULTILINE); open(f,'w').write(n); print(f'Updated {f}')"
	@echo "Version bumped to $(RELEASE_VERSION)"

# Initial release (one-time, when no tags exist yet)
first_release: require_gitflow_next
	git flow release start 0.0.1
	@echo ""
	@echo "=== First release branch created (release/0.0.1) ==="
	@echo "Next steps:"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. make release_and_push_GHCR    # Finish release + push to GHCR"

require_gitflow_next:
	@if ! git flow version 2>/dev/null | grep -q 'git-flow-next'; then \
		echo "Error: git-flow-next required (Go rewrite). Install: brew install git-flow-next"; \
		exit 1; \
	fi

minor_release: require_gitflow_next
	@# Start a minor release with incremented minor version
	git flow release start $$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1 | awk -F'.' '{print $$1"."$$2+1".0"}')
	@echo ""
	@echo "=== Release branch created ==="
	@echo ""
	@echo "Hooks / migrations / config only (no binary change):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make release_finish           # Merge master + develop, tag, push"
	@echo "  4. make it_deploy                # Deploy hooks layer to CapRover"
	@echo ""
	@echo "Binary change (new PocketBase version / Go code / branding):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make it_build                 # Build Docker image"
	@echo "  4. make it_run                   # Smoke test"
	@echo "  5. make ghcr_login               # Authenticate with GHCR"
	@echo "  6. make release_and_push_GHCR    # Finish release + push to GHCR"

patch_release: require_gitflow_next
	@# Start a patch release with incremented patch version
	git flow release start $$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1 | awk -F'.' '{print $$1"."$$2"."$$3+1}')
	@echo ""
	@echo "=== Release branch created ==="
	@echo ""
	@echo "Hooks / migrations / config only (no binary change):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make release_finish           # Merge master + develop, tag, push"
	@echo "  4. make it_deploy                # Deploy hooks layer to CapRover"
	@echo ""
	@echo "Binary change (new PocketBase version / Go code / branding):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make it_build                 # Build Docker image"
	@echo "  4. make it_run                   # Smoke test"
	@echo "  5. make ghcr_login               # Authenticate with GHCR"
	@echo "  6. make release_and_push_GHCR    # Finish release + push to GHCR"

major_release: require_gitflow_next
	@# Start a major release with incremented major version
	git flow release start $$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1 | awk -F'.' '{print $$1+1".0.0"}')
	@echo ""
	@echo "=== Release branch created ==="
	@echo ""
	@echo "Hooks / migrations / config only (no binary change):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make release_finish           # Merge master + develop, tag, push"
	@echo "  4. make it_deploy                # Deploy hooks layer to CapRover"
	@echo ""
	@echo "Binary change (new PocketBase version / Go code / branding):"
	@echo "  1. make bump_release_version     # Update README.md version"
	@echo "  2. git add -A && git commit      # Commit version bump"
	@echo "  3. make it_build                 # Build Docker image"
	@echo "  4. make it_run                   # Smoke test"
	@echo "  5. make ghcr_login               # Authenticate with GHCR"
	@echo "  6. make release_and_push_GHCR    # Finish release + push to GHCR"

hotfix: require_gitflow_next
	@# Start a hotfix with incremented patch.patch version (fourth component)
	git flow hotfix start $$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1 | awk -F'.' '{if (NF < 4) print $$1"."$$2"."$$3".1"; else print $$1"."$$2"."$$3"."$$4+1}')
	@echo ""
	@echo "=== Hotfix branch created ==="
	@echo ""
	@echo "  1. Fix the issue"
	@echo "  2. make bump_release_version     # Update README.md version"
	@echo "  3. git add -A && git commit      # Commit fix + version bump"
	@echo ""
	@echo "Hooks / migrations / config only (no binary change):"
	@echo "  4. make hotfix_finish            # Merge master + develop, tag, push"
	@echo "  5. make it_deploy                # Deploy hooks layer to CapRover"
	@echo ""
	@echo "Binary change (new PocketBase version / Go code / branding):"
	@echo "  4. make it_build                 # Build Docker image"
	@echo "  5. make it_run                   # Smoke test"
	@echo "  6. make ghcr_login               # Authenticate with GHCR"
	@echo "  7. make hotfix_and_push_GHCR     # Finish hotfix + push to GHCR"

release_finish: require_gitflow_next
	@echo "=== Finishing release ==="
	@echo "Merging to master, tagging, pushing..."
	git flow release finish && git push origin develop && git push origin master && git push --tags && git checkout develop
	@echo ""
	@echo "=== Release complete ==="
	@echo "Tag: $$(git tag --sort=-v:refname | head -n 1)"

hotfix_finish: require_gitflow_next
	@echo "=== Finishing hotfix ==="
	git flow hotfix finish && git push origin develop && git push origin master && git push --tags && git checkout develop

release_and_push_GHCR: release_finish
	@echo ""
	@echo "=== Building and pushing to GHCR ==="
	@make it_build_multi_arch_push_GHCR
	@echo ""
	@VTAG=$$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1); \
	echo "=== Release $$VTAG published ==="; \
	echo "Verify: docker pull $(GHCR_IMAGE_NAME):$$VTAG"; \
	echo "Verify: docker pull $(GHCR_IMAGE_NAME):latest"

hotfix_and_push_GHCR: hotfix_finish
	@echo ""
	@echo "=== Building and pushing to GHCR ==="
	@make it_build_multi_arch_push_GHCR
	@echo ""
	@VTAG=$$(git tag --sort=-v:refname | sed 's/^v//' | head -n 1); \
	echo "=== Hotfix $$VTAG published ==="; \
	echo "Verify: docker pull $(GHCR_IMAGE_NAME):$$VTAG"; \
	echo "Verify: docker pull $(GHCR_IMAGE_NAME):latest"

.PHONY: release help it_stop it_clean it_gone \
	it_build it_build_no_cache it_run it_run_dev it_run_ghcr \
	it_build_n_run it_build_n_run_no_cache it_build_n_test_fresh \
	it_deploy ghcr_login ensure_builder it_build_multi_arch_push_GHCR \
	show_version bump_release_version first_release require_gitflow_next \
	minor_release patch_release major_release hotfix \
	release_finish hotfix_finish \
	release_and_push_GHCR hotfix_and_push_GHCR \
	test test_fresh

# ---------------------------------------------------------------------------
# Interactive release (full flow via ~/bin/git-release)
# ---------------------------------------------------------------------------
release:
	@scripts/release.sh

## >>> startr worktree block v1 (startr.sh/Makefile, 2026-11-12) >>>
## One checkout per repo. A worktree is for one parallel task, and it goes
## the day its branch lands; a landed branch goes too. wt_check fails while
## either lingers, so the rule is a gate, not a memory.
## To update a repo, replace everything between the two marker lines.
## Guide: https://startr.sh/docs/makefile-worktrees/
##   make wt NAME=quick-note       feature/quick-note from WT_BASE, in ../<repo>-wt/quick-note
##   make wt NAME=fix/typo         a name with a slash is the branch; the folder is fix-typo
##   make wt_list                  each worktree and spare branch: ahead/behind, changes, age
##   make wt_done NAME=quick-note  clean and landed only: removes the worktree and its branch
##   make wt_tidy                  wt_done for every clean, landed worktree and branch
##   make wt_check                 fails on a landed worktree or branch, or one over WT_DAYS
## "Landed" means merging the branch into WT_BASE changes nothing: merged,
## squashed or rebased in. The remote branch is never touched.
WT_BASE ?= $(shell for b in develop main master; do git rev-parse -q --verify "refs/heads/$$b" >/dev/null && { echo $$b; break; }; done)
WT_MAX ?= 3
WT_DAYS ?= 3
WT_KEEP ?= develop main master gh-pages

.PHONY: wt wt_list wt_done wt_tidy wt_check

## Shell functions the five targets share. Every worktree but the main
## checkout prints as "path<TAB>branch" ("-" when detached).
define wt_sh
tab=$$(printf '\t'); now=$$(date +%s); base="$(WT_BASE)"; \
main=$$(cd "$$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd); \
root="$$main-wt"; \
git worktree prune; \
worktrees() { git worktree list --porcelain | awk '/^worktree /{n++; p=substr($$0,10)} n>1 && /^branch /{print p "\t" substr($$0,19)} n>1 && /^detached/{print p "\t-"}'; }; \
spare_branches() { held=$$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p'); \
	git for-each-ref --format='%(refname:short)' refs/heads | while read -r b; do \
	case " $(WT_KEEP) $$base " in *" $$b "*) continue;; esac; \
	printf '%s\n' "$$held" | grep -qxF "$$b" || echo "$$b"; done; }; \
contained() { git merge-base --is-ancestor "$$1" "$$base" && return 0; \
	t=$$(git merge-tree --write-tree "$$base" "$$1" 2>/dev/null) && [ "$$t" = "$$(git rev-parse "$$base^{tree}")" ]; }; \
worked() { [ "$$(git reflog show "refs/heads/$$1" 2>/dev/null | wc -l | tr -d ' ')" -gt 1 ]; }; \
age() { c=$$(git reflog show --date=unix --format=%gd "refs/heads/$$1" 2>/dev/null | tail -1 | sed -n 's/.*@{\([0-9]*\)}$$/\1/p'); \
	[ -n "$$c" ] && echo $$(( (now - c) / 86400 )) || echo 0; }; \
changes() { git -C "$$1" status --porcelain | wc -l | tr -d ' '; }; \
remove_one() { if [ -n "$$1" ]; then git worktree remove "$$1" || return 1; echo "Removed $$1"; fi; \
	if [ "$$2" != "-" ]; then git branch -D "$$2" >/dev/null && echo "Deleted $$2 (its work is in $$base)"; \
	git rev-parse -q --verify "refs/remotes/origin/$$2" >/dev/null && echo "  origin still has it: git push origin --delete $$2"; fi; \
	rmdir "$$root" 2>/dev/null; true; }
endef

## The bodies of wt_list and wt_check, shared with wt and wt_tidy. They are
## defines, not recursive $(MAKE) calls, so `make -n wt` runs nothing.
define wt_list_sh
echo "base: $${base:-none}"; \
worktrees | while IFS="$$tab" read -r p b; do \
	n=$$(changes "$$p"); line="$$p  $$b  $$n changed"; \
	if [ "$$b" != "-" ] && [ -n "$$base" ]; then \
		line="$$line  +$$(git rev-list --count "$$base..$$b")/-$$(git rev-list --count "$$b..$$base")  $$(age "$$b")d"; \
		[ "$$n" = 0 ] && worked "$$b" && contained "$$b" && line="$$line  LANDED: make wt_done"; \
	fi; echo "$$line"; done; \
[ -n "$$base" ] && spare_branches | while read -r b; do \
	line="branch $$b  +$$(git rev-list --count "$$base..$$b")/-$$(git rev-list --count "$$b..$$base")  $$(age "$$b")d"; \
	contained "$$b" && line="$$line  LANDED: make wt_done NAME=$$b"; echo "$$line"; done; true
endef

define wt_check_sh
[ -n "$$base" ] || { echo "wt_check: no develop, main or master branch here; skipped"; exit 0; }; \
bad=$$( worktrees | while IFS="$$tab" read -r p b; do \
	[ "$$b" = "-" ] && continue; \
	[ "$$(changes "$$p")" = 0 ] && worked "$$b" && contained "$$b" && { echo "  landed worktree: $$p ($$b)"; continue; }; \
	[ "$$(age "$$b")" -le $(WT_DAYS) ] || echo "  $$(age "$$b") days old: $$p ($$b); land it or make wt_done"; done; \
	spare_branches | while read -r b; do contained "$$b" && echo "  landed branch: $$b"; done ); \
[ -z "$$bad" ] || { echo "wt_check failed (WT_DAYS=$(WT_DAYS)):"; echo "$$bad"; echo "make wt_tidy clears what landed; land or drop the rest."; exit 1; }
endef

wt:
	@[ "$(origin NAME)" = "command line" ] || { echo "Usage: make wt NAME=quick-note"; exit 1; }; \
	$(wt_sh); [ -n "$$base" ] || { echo "No develop, main or master branch: set WT_BASE"; exit 1; }; \
	case "$(NAME)" in */*) b="$(NAME)";; *) b="feature/$(NAME)";; esac; \
	dir="$$root/$$(echo "$(NAME)" | tr / -)"; \
	open=$$(worktrees | wc -l | tr -d ' '); \
	[ "$$open" -lt $(WT_MAX) ] || { echo "$$open worktrees open, and WT_MAX is $(WT_MAX). Land one, then make wt_done."; worktrees; exit 1; }; \
	( $(wt_check_sh) ) || { echo "Clear those before a new worktree."; exit 1; }; \
	! git rev-parse -q --verify "refs/heads/$$b" >/dev/null || { echo "$$b already exists"; exit 1; }; \
	git worktree add -q -b "$$b" "$$dir" "$$base" && \
	echo "Ready: cd $$dir ($$b from $$base). When it lands: make wt_done NAME=$(NAME)"

wt_list:
	@$(wt_sh); $(wt_list_sh)

wt_done:
	@[ "$(origin NAME)" = "command line" ] || { echo "Usage: make wt_done NAME=quick-note"; exit 1; }; \
	$(wt_sh); [ -n "$$base" ] || { echo "No develop, main or master branch: set WT_BASE"; exit 1; }; \
	case "$(NAME)" in */*) want="$(NAME)";; *) want="feature/$(NAME)";; esac; \
	dir="$$root/$$(echo "$(NAME)" | tr / -)"; \
	hit=$$(worktrees | awk -F"$$tab" -v d="$$dir" -v b="$$want" '$$1==d || $$2==b {print; exit}'); \
	if [ -n "$$hit" ]; then p=$${hit%%"$$tab"*}; b=$${hit#*"$$tab"}; \
	elif git rev-parse -q --verify "refs/heads/$$want" >/dev/null; then p=; b="$$want"; \
	else echo "No worktree at $$dir and no branch $$want"; exit 1; fi; \
	if [ -n "$$p" ]; then \
		case "$$(pwd -P)/" in "$$(cd "$$p" && pwd -P)/"*) echo "Run it from $$main, not from inside the worktree"; exit 1;; esac; \
		n=$$(changes "$$p"); [ "$$n" = 0 ] || { echo "$$p has $$n uncommitted changes:"; git -C "$$p" status --short; exit 1; }; \
	fi; \
	[ "$$b" = "-" ] || contained "$$b" || { echo "$$b is not in $$base yet: $$(git rev-list --count "$$base..$$b") commits to land"; exit 1; }; \
	remove_one "$$p" "$$b"

wt_tidy:
	@$(wt_sh); [ -n "$$base" ] || { echo "No develop, main or master branch: set WT_BASE"; exit 1; }; \
	worktrees | while IFS="$$tab" read -r p b; do \
		[ "$$b" != "-" ] && [ "$$(changes "$$p")" = 0 ] && worked "$$b" && contained "$$b" && remove_one "$$p" "$$b"; done; \
	spare_branches | while read -r b; do contained "$$b" && remove_one "" "$$b"; done; \
	$(wt_list_sh)

wt_check:
	@$(wt_sh); $(wt_check_sh)
## <<< startr worktree block v1 <<<
