# Pin the multi-architecture Node 24 Alpine index digest. Renovate or the
# release process must deliberately update this after CVE review.
FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/server.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
