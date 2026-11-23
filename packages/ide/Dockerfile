# The data-gateway-ide: the app built outside (npm run build → dist/) and its backend (server/server.mjs, Node without
# dependencies), which serves it and is its proxy to the data-gateways (docs/DATA_GATEWAY.md §11.9). No state, no
# secrets: the connections stay in the browser of each viewer. docker build -t flaviorita/data-gateway-ide:<version> .
# DATA_GATEWAY_IDE_TARGETS: the origins the proxy may reach (comma separated), or * for any; without it, none.
FROM node:24-alpine
WORKDIR /app
COPY server/server.mjs ./server/server.mjs
COPY dist/ ./dist/
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
# node directly: SIGTERM reaches the server
CMD ["node", "server/server.mjs"]
