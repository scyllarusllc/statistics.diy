.PHONY: dev dev-stop

dev:
	bash scripts/dev.sh

dev-stop:
	docker compose -p statistics-diy-dev -f deploy/dev.compose.yaml down
