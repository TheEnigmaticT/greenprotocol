# Runtime image for the durable SciSure Node/TypeScript worker only.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# tsx is a runtime dependency of this worker entry point, so retain dev packages.
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ARG GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.title="gcai-scisure-worker"
CMD ["npx", "tsx", "scripts/run-scisure-worker.ts"]
