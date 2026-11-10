# AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-11-10.
# Scope: Images for the observability stack, one target per component, each with its
# configuration from this folder built in. Author review: Pending.
#
#   docker build --target mimir observability
#
# compose.observability.yaml builds them for Docker Compose, and cloudbuild.yaml for Cloud
# Run, where deploy.sh runs them as the containers of a single service, `observability`.
# The ENV values are the Docker Compose ones; deploy.sh overrides them on Cloud Run (where
# every host is localhost and the data is kept in GCS buckets).

FROM otel/opentelemetry-collector-contrib:0.164.0 AS otel-collector
COPY otel-collector.yaml /etc/otelcol/config.yaml
# Docker Compose only (container metrics from the Docker socket): added with a second --config.
COPY otel-collector.local.yaml /etc/otelcol/local.yaml
ENV MIMIR_HOST=mimir LOKI_HOST=loki TEMPO_HOST=tempo DEPLOYMENT_ENVIRONMENT=local
CMD ["--config=/etc/otelcol/config.yaml"]

FROM grafana/mimir:3.2.4 AS mimir
COPY mimir.yaml /etc/mimir/mimir.yaml
ENV MIMIR_STORAGE_BACKEND=filesystem MIMIR_GCS_BUCKET= MIMIR_FLUSH_ON_SHUTDOWN=false
CMD ["-config.file=/etc/mimir/mimir.yaml", "-config.expand-env=true"]

FROM grafana/loki:3.7.9 AS loki
COPY loki.yaml /etc/loki/config.yaml
ENV LOKI_OBJECT_STORE=filesystem LOKI_GCS_BUCKET= LOKI_FLUSH_ON_SHUTDOWN=false
CMD ["-config.file=/etc/loki/config.yaml", "-config.expand-env=true"]

FROM grafana/tempo:2.10.10 AS tempo
COPY tempo.yaml /etc/tempo/config.yaml
ENV TEMPO_STORAGE_BACKEND=local TEMPO_GCS_BUCKET= MIMIR_HOST=mimir
CMD ["-config.file=/etc/tempo/config.yaml", "-config.expand-env=true"]

FROM grafana/grafana:13.2.5 AS grafana
COPY grafana/provisioning /etc/grafana/provisioning
ENV MIMIR_HOST=mimir LOKI_HOST=loki TEMPO_HOST=tempo \
    GF_ANALYTICS_REPORTING_ENABLED=false GF_ANALYTICS_CHECK_FOR_UPDATES=false

# Cloud Run only: the service's entry point, in front of Grafana and the collector.
FROM nginx:1.30.6-alpine AS proxy
COPY proxy.conf.template /etc/nginx/templates/default.conf.template
