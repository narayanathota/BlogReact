# ---- Stage 1: build the React app into static files ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# baked into the JS bundle at build time; "/api" is proxied to the backend by nginx
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- Stage 2: tiny non-root nginx serving the build ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
# nginx fills ${BACKEND_HOST} / ${BACKEND_PORT} from the environment when it starts
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV BACKEND_HOST=backend-service BACKEND_PORT=5000
# non-root user (numeric UID so Kubernetes runAsNonRoot can verify it)
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/ || exit 1
