# build from repo root: docker build -f infra/api.Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# also used by the migrate service
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --filter @nook/api...
COPY apps/api apps/api
# prisma generate needs some url, it doesn't connect
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @nook/api db:generate \
 && pnpm --filter @nook/api build

FROM base AS web-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --filter @nook/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
ARG VITE_GA_MEASUREMENT_ID=""
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
RUN pnpm --filter @nook/web build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm install --frozen-lockfile --prod --filter @nook/api...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/views apps/api/views
COPY --from=build /repo/apps/api/public apps/api/public
COPY --from=web-build /repo/apps/web/dist apps/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/api/dist/src/main.js"]

# render builds the last stage, keep this one at the bottom
FROM build AS render
ENV NODE_ENV=production \
    UPLOAD_DIR=/data/uploads
COPY --from=web-build /repo/apps/web/dist apps/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 10000
CMD ["sh", "-c", "(cd apps/api && ./node_modules/.bin/prisma migrate deploy) && exec node apps/api/dist/src/main.js"]
