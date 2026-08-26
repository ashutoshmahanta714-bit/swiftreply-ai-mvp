FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=10000
ENV HOST=0.0.0.0

USER node

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
