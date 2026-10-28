FROM node:lts-alpine

WORKDIR /usr/src
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js relay.js ./

EXPOSE 4000
EXPOSE 4001

CMD ["node", "server.js"]
