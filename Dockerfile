# Etapa de build: instala TODAS las dependencias (incluidas las de desarrollo),
# genera el cliente de Prisma para Linux y compila TypeScript.
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./

# El esquema debe estar presente antes de `prisma generate`.
COPY prisma ./prisma

RUN npm ci && \
    npm cache clean --force

# Se copian tsconfig y src ANTES de generar, para que el cliente generado para
# Linux sobrescriba cualquier cliente comiteado desde otra plataforma.
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate

RUN npm run build

# Etapa de produccion: imagen minima, solo dependencias de runtime.
FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

# Usuario sin privilegios: el proceso no corre como root.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["node", "dist/app.js"]
