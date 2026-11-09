# Build the PWA, then ship only dist/, the server and the search function.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Browser keys are public by design (they end up in the JS bundle), so they come in
# as build args. Server secrets (Elasticsearch) never do: they come from a Secret at runtime.
ARG VITE_RADAR_KEY=
ARG VITE_DASH0_ENDPOINT=
ARG VITE_DASH0_TOKEN=
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/dist ./dist
COPY --from=build /src/api/search.ts ./api/search.ts
COPY server.mjs package.json ./
ARG APP_VERSION=dev
ENV PORT=8080 APP_VERSION=$APP_VERSION NODE_ENV=production
# The node image's "node" user, by number so runAsNonRoot can check it.
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
