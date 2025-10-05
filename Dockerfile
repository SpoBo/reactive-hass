# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy TypeScript config and source code
COPY tsconfig*.json ./
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Environment variables
ENV NODE_ENV=production

# Optional: Create data directory for config file (if not using env vars)
RUN mkdir -p /app/data

# Optional: Expose the data volume for config file
VOLUME ["/app/data"]

# Run the application
CMD ["node", "./dist/index.js"]
