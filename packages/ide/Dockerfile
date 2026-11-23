# The data-gateway-ide: built outside (npm run build → dist/), served by nginx. No state, no secrets: the connections stay
# in the browser of each viewer. docker build -t flaviorita/data-gateway-ide:<version> .
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
