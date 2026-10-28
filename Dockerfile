FROM node:lts-alpine

WORKDIR /usr/src
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

EXPOSE 4000
EXPOSE 4001

CMD ["node", "src/server.ts"]
