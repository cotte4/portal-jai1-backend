FROM node:20-bookworm

WORKDIR /app

# Copy package files first — Docker layer cache means npm ci only re-runs when
# package.json or package-lock.json changes, not on every source change.
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci

# Install Firefox binary + all OS-level system dependencies Playwright needs.
# Must run AFTER npm ci so the local playwright package is available.
RUN npx playwright install --with-deps firefox

# Copy source and build
COPY . .
RUN npx prisma generate && npm run build

# Force headless mode inside the container — no display available in Railway
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3000
CMD ["node", "dist/main"]
