FROM node:22.22.0-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM node:22.22.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/migrate-db.mjs scripts/migration-error.mjs scripts/migration-runner-policy.mjs scripts/run-maintenance-cleanup.mjs scripts/maintenance-cleanup-policy.mjs ./scripts/
COPY --chown=node:node database ./database

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/pilot/index.js"]
