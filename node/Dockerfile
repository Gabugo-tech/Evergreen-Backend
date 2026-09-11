FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p logs
EXPOSE 4000
USER node
CMD ["node", "dist/server.js"]
