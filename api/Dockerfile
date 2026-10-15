# Recipe for the API container.
# Built from the project root, so paths below are relative to western-calendar/.
FROM node:22-alpine

# Same folder layout as the repo (/app/api, /app/shared) so imports like
# '../../shared/ics.js' work identically on your Mac and in the container.
WORKDIR /app/api

# Copy package.json first and install. Docker caches this step, so rebuilding
# after a code change doesn't reinstall every package.
COPY api/package.json ./
RUN npm install --omit=dev

# Then copy our code.
COPY api/src ./src
COPY api/migrations ./migrations
COPY api/examples ./examples
COPY shared /app/shared

# Don't run as the all-powerful root user inside the container.
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
