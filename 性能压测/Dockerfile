FROM node:22-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server/ ./
RUN npm run build
CMD ["node", "dist/index.js"]
