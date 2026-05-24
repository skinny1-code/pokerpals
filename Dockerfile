FROM node:22-slim
WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --omit=dev

# Copy server and deployment manifest
COPY server/ ./server/
COPY deployments/ ./deployments/

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "server/index.js"]
