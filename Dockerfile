FROM node:20-bookworm

WORKDIR /app

# Copy package files first — Docker layer cache means npm ci only re-runs when
# package.json or package-lock.json changes, not on every source change.
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate && npm run build

# Force headless mode inside the container — no display available in Railway
ENV PLAYWRIGHT_HEADLESS=true

# Railway injects PORT at runtime — don't hardcode EXPOSE 3000 or the healthcheck
# will hit port 3000 while the app is actually listening on Railway's PORT (8080)
CMD ["node", "dist/src/main"]
