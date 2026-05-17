# Image used by Glama (and any sandbox) to introspect the MCP server.
# No PROPLINE_API_KEY is baked in or required: the server starts and
# answers tools/list keyless; the key is enforced lazily on tool calls.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

ENTRYPOINT ["node", "dist/index.js"]
