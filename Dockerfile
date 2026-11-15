FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
