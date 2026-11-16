FROM node:22-slim
WORKDIR /app/worker
COPY worker/package*.json ./
RUN npm ci
COPY worker/ ./
COPY shared /app/shared
ENV NODE_ENV=production
RUN mkdir -p /data/evidence && chown -R node:node /data
USER node
CMD ["npm","start"]
