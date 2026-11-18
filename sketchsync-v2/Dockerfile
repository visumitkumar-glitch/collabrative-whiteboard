FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# mongodb is an optional dependency: only used when MONGODB_URI is set
RUN npm install --omit=dev --no-audit --no-fund || true
COPY server.js ./
COPY public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8080}/healthz || exit 1
CMD ["node", "server.js"]
