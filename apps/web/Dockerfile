# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build

# Deterministic installs: pnpm version comes from packageManager in
# package.json, and only the packages listed in pnpm-workspace.yaml
# (`allowBuilds`) may run install scripts.
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /repo

# Copy manifests first so the dependency layer is cached independently of the
# application source.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/web-shared/package.json packages/web-shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they
# are build args rather than runtime env. They are public values only: the
# Supabase anon/publishable key and the Midtrans *client* key. Never pass a
# service-role key or a Midtrans server key here.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_AUTH_CALLBACK_URL
ARG NEXT_PUBLIC_COOKIE_DOMAIN=""
ARG NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
ARG NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox
# Internal staging tools; ignored unless the Midtrans profile is sandbox.
ARG NEXT_PUBLIC_SAVEBITE_E2E=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_AUTH_CALLBACK_URL=$NEXT_PUBLIC_AUTH_CALLBACK_URL \
    NEXT_PUBLIC_COOKIE_DOMAIN=$NEXT_PUBLIC_COOKIE_DOMAIN \
    NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=$NEXT_PUBLIC_MIDTRANS_CLIENT_KEY \
    NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=$NEXT_PUBLIC_MIDTRANS_ENVIRONMENT \
    NEXT_PUBLIC_SAVEBITE_E2E=$NEXT_PUBLIC_SAVEBITE_E2E \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @savebite/web build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /repo

# Run as the unprivileged `node` user that already exists in the base image.
# The standalone output is written to /repo, so it has to be readable by uid
# 1000. Nothing here needs write access at runtime.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

# Liveness only: /ready touches the database and is used by the orchestrator,
# while a failed /api/health must not trigger a restart loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Next.js' standalone server installs SIGTERM/SIGINT handlers and drains in
# flight requests. `docker stop` sends SIGTERM and then SIGKILL after
# `stop_grace_period` (30s in compose.yml); `init: true` in compose adds tini as
# PID 1 so the signal is actually delivered.
CMD ["node", "apps/web/server.js"]
