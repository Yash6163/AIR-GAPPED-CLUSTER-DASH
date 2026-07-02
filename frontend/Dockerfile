FROM node:18-alpine

WORKDIR /app

# Copy dependency configuration
COPY package.json ./
RUN npm install

# Copy source code files
COPY . .

# Build production assets
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Expose port
EXPOSE 3000

# Start production server
CMD ["npm", "run", "start"]
