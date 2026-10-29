FROM node:26-alpine

WORKDIR /usr/src
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

EXPOSE 4000

CMD ["node", "src/server.ts"]
