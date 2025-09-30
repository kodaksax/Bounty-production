FROM node:18-alpine

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy workspace files for dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY services/api/package.json ./services/api/

# Install all dependencies at workspace root
RUN pnpm install --frozen-lockfile

# Copy API source code
COPY services/api/ ./services/api/

# Build the API application
WORKDIR /app/services/api
RUN pnpm run build

# Expose port
EXPOSE 3001

# Start the application
CMD ["pnpm", "run", "start"]