# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs ./
COPY src/ src/
COPY views/ views/
COPY locales/ locales/
COPY public/ public/
COPY scripts/ scripts/
RUN mkdir -p /data && chown node:node /data
ENV PORT=8080 BINDING=0.0.0.0 DATABASE_PATH=/data/statistics.sqlite LOAD_ENV=0
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "server.mjs"]
