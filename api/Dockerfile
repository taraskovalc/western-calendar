# Recipe for the API container.
# Start from an official, small image that already has Node.js 22 installed.
FROM node:22-alpine

WORKDIR /app

# Copy package.json first and install. Docker caches this step, so rebuilding
# after a code change doesn't reinstall every package.
COPY package.json ./
RUN npm install --omit=dev

# Then copy our code.
COPY src ./src

# Don't run as the all-powerful root user inside the container.
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
