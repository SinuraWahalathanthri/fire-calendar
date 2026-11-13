# Stage 1: build the React frontend
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: the server (no runtime npm dependencies) + built frontend
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY --from=web /web/dist ./web/dist
ENV PORT=8080 DATA_DIR=/app/data NODE_ENV=production
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://localhost:8080/api/status >/dev/null || exit 1
USER node
CMD ["node", "server/index.js"]
