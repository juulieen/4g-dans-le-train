# Build SvelteKit (adapter-node) puis image de production légère, runtime Bun.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

# --- Production ---
FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
# Dépendances de prod uniquement (adapter-node sert le build).
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production
COPY --from=build /app/build ./build
# Migrations + schéma, pour pouvoir appliquer db:migrate au démarrage si besoin.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/server/db ./src/lib/server/db

RUN mkdir -p /app/data
EXPOSE 3000
# adapter-node écoute sur PORT (défaut 3000).
CMD ["bun", "./build/index.js"]
