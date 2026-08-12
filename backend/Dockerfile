# === Build stage ===
FROM node:18-alpine AS builder

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# === Production stage ===
FROM node:18-alpine

# ffmpeg brings ffprobe, which is used to measure narration length.
# The font packages are required by the drawtext filter: on a bare Alpine image no
# font files exist, so caption rendering fails outright — and DejaVu is also one of
# the few default fonts that actually covers Cyrillic.
# Override the choice with FFMPEG_FONT_FILE if a specific face is needed.
RUN apk add --no-cache ffmpeg ttf-dejavu fontconfig

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist/ ./dist/

# Create uploads directory
RUN mkdir -p /app/uploads/photos /app/uploads/audio /app/uploads/videos /app/uploads/temp

EXPOSE 4000

CMD ["node", "dist/server.js"]
