FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY mobile/package.json ./mobile/package.json
RUN npm ci --workspace=api --include-workspace-root --include=dev
COPY api ./api
COPY db ./db
COPY protocol ./protocol
RUN npm run build:api
WORKDIR /app/api
ENV NODE_ENV=development
EXPOSE 3000
CMD ["node", "dist/server.js"]
