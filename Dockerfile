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

# Install OpenSSH server and client (client for SSH connections from container)
# Install sshpass for password-based SSH authentication
RUN apk add --no-cache openssh openssh-keygen openssh-client sshpass

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Setup SSH
RUN mkdir -p /var/run/sshd && \
    ssh-keygen -A && \
    mkdir -p /root/.ssh && \
    chmod 700 /root/.ssh

# Create SSH configuration
RUN echo "PermitRootLogin yes" >> /etc/ssh/sshd_config && \
    echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "Port 22" >> /etc/ssh/sshd_config

# Environment variables
ENV NODE_ENV=production

# Optional: Create data directory for config file (if not using env vars)
RUN mkdir -p /app/data

# Optional: Expose the data volume for config file
VOLUME ["/app/data"]

# Expose SSH port
EXPOSE 22

# Create entrypoint script to start both SSH and the application
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo '/usr/sbin/sshd -D &' >> /entrypoint.sh && \
    echo 'exec node ./dist/index.js' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Run the application with SSH
CMD ["/entrypoint.sh"]
