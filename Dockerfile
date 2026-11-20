# One file, three images:  docker build --target api|worker|web ...
# The API and worker run TypeScript through tsx (as in development): simple and reliable for this workspace layout.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci

FROM deps AS source
COPY apps ./apps

FROM node:22-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=source /app ./
USER node
EXPOSE 4000
HEALTHCHECK CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "@technews/api"]

FROM node:22-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=source /app ./
USER node
CMD ["npm", "run", "worker", "-w", "@technews/worker"]

FROM source AS web-build
# Browser-visible settings are baked in at build time.
ARG VITE_API_URL
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
RUN npm run build -w @technews/web

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
