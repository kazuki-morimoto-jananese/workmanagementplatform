FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run check && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/reset-password.mjs ./scripts/reset-password.mjs
COPY scripts/backup.mjs ./scripts/backup.mjs
COPY scripts/restore.mjs ./scripts/restore.mjs
COPY scripts/restore-export.mjs ./scripts/restore-export.mjs
COPY scripts/seed-sales-demo.mjs ./scripts/seed-sales-demo.mjs
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
