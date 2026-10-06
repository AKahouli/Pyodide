FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY .generated/observability/ .generated/observability/
COPY package.json package-lock.json ./
# The staging step (scripts/observability/build-sdks.mjs) keeps the lock's
# integrity hash in sync with the staged SDK tarball, so npm ci stays exact.
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY .generated/observability/ .generated/observability/
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
