FROM node:24.21.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

FROM dependencies AS build
COPY . .
RUN npm run build

# Operational tools retain tsx and source migrations, outside the web image.
FROM dependencies AS tools
ENV NODE_ENV=production
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node src/server/passwords.ts ./src/server/passwords.ts
USER node
CMD ["node", "--import", "tsx", "scripts/migrate.ts"]

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Standalone output does not include public/ (brand icons referenced by metadata).
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
