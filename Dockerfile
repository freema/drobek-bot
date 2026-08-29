# syntax=docker/dockerfile:1
# One image for the api and the worker; the container command picks the entry
# point. Build stage installs and compiles; the runtime stage carries only
# production dependencies and the compiled output.

ARG PNPM_VERSION=10.33.2

FROM node:22-alpine AS base
ARG PNPM_VERSION
ENV npm_config_store_dir=/pnpm/store
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @drobek-bot/api... --filter @drobek-bot/worker...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @drobek-bot/contracts --filter @drobek-bot/api --filter @drobek-bot/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter @drobek-bot/api... --filter @drobek-bot/worker...
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist

# The commit the image was built from; reported by /api/health.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
