FROM node:26-slim
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
COPY migrations /app/migrations
COPY shared /app/shared
COPY VERSION /app/VERSION
ENV NODE_ENV=production
RUN mkdir -p /data/evidence && chown -R node:node /data
USER node
CMD ["npm","start"]
