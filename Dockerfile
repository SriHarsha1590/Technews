FROM node:24.12.0-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci
COPY packages ./packages
COPY apps ./apps
RUN ./node_modules/.bin/tsc -p packages/shared/tsconfig.build.json \
 && node -e "const fs=require('fs');const p='packages/shared/package.json';const j=require('./'+p);j.main='dist/index.js';j.types='dist/index.d.ts';j.exports={'.':'./dist/index.js','./safe-fetch':'./dist/safe-fetch.js'};fs.writeFileSync(p,JSON.stringify(j))" \
 && ./node_modules/.bin/tsc -p apps/api/tsconfig.build.json \
 && ./node_modules/.bin/tsc -p apps/worker/tsconfig.build.json

FROM node:24.12.0-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --omit=dev

FROM production-deps AS api
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

FROM production-deps AS worker
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "const fs=require('fs');try{const age=Date.now()-Number(fs.readFileSync('/tmp/technews-worker-health','utf8'));process.exit(age>=0&&age<90000?0:1)}catch{process.exit(1)}"
CMD ["node", "apps/worker/dist/worker.js"]

FROM build AS web-build
ARG VITE_API_URL
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
RUN npm run build -w @technews/web

FROM nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.inc /etc/nginx/security-headers.inc
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
