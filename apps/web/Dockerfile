# syntax=docker/dockerfile:1
# Builds the SPA and serves it with nginx, which also proxies /api/ to the api.

ARG PNPM_VERSION=10.33.2

FROM node:22-alpine AS build
ARG PNPM_VERSION
ENV npm_config_store_dir=/pnpm/store
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @drobek-bot/web...
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @drobek-bot/contracts build && pnpm --filter @drobek-bot/web build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
