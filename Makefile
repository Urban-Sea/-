.PHONY: up down build logs db-shell db-dump seed schema help

# --- Development ---

up: ## Start all containers
	docker compose up -d

down: ## Stop all containers
	docker compose down

build: ## Build all containers
	docker compose build --parallel

logs: ## Tail all container logs
	docker compose logs -f --tail=100

status: ## Show container status
	docker compose ps

# --- Database ---

db-shell: ## Open psql shell
	docker compose exec postgres psql -U app open_regime

db-dump: ## Dump database to file
	docker compose exec postgres pg_dump -U app open_regime > db/seed/dump_$$(date +%Y%m%d).sql

seed: ## Load seed data from Supabase export
	docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql

schema: ## Regenerate schema SQL from Supabase CSVs
	python scripts/generate_schema.py

# --- Data Export ---

export-supabase: ## Export data from Supabase REST API
	bash scripts/export-supabase.sh

# --- Help ---

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
