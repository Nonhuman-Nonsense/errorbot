FROM node:lts-alpine

WORKDIR /usr/src
COPY package*.json ./
RUN npm ci --only=production
COPY server.js .

EXPOSE 4000
EXPOSE 4001

CMD ["npm", "start"]
