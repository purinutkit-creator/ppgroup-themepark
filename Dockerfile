# Single-service image (API + web app on one origin), e.g. for Render.
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w apps/api && npm run build -w apps/web

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/api
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
ENV UPLOAD_DIR=/data/uploads WEB_DIST=/app/apps/web/dist PORT=10000
EXPOSE 10000
# SEED_DEMO=true loads the demo data once (skipped when the database already has a branch)
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = \"true\" ]; then node dist/db/seed.js; fi && exec node dist/server.js"]
