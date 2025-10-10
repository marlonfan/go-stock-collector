# Build stage
FROM golang:1.23-alpine AS builder

# Install build dependencies (only tzdata needed now)
RUN apk add --no-cache tzdata

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application (no CGO needed with modernc.org/sqlite)
ENV CGO_ENABLED=0
ENV GOOS=linux
ENV GOARCH=amd64
RUN go build -ldflags="-s -w" -o stock-data-collector .

# Final stage
FROM alpine:latest

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    tzdata \
    ca-certificates

# Install required timezones
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /usr/share/zoneinfo/America/New_York /tmp/ && \
    apk del tzdata && \
    mkdir -p /usr/share/zoneinfo/Asia /usr/share/zoneinfo/America && \
    cp /tmp/Shanghai /usr/share/zoneinfo/Asia/ && \
    cp /tmp/New_York /usr/share/zoneinfo/America/

# Create app user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/stock-data-collector .

# Copy static files and data
COPY --from=builder /app/static ./static
COPY --from=builder /app/stocks.csv .

# Create data directory
RUN mkdir -p data && chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/stocks || exit 1

# Default command - start web server with scheduler enabled
CMD ["./stock-data-collector", "-mode=web", "-port=8080", "-scheduler=true"]