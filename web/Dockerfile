FROM node:22-slim AS build
WORKDIR /w
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM caddy:2
COPY --from=build /w/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
