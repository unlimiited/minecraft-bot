FROM node:20-alpine

RUN apk add --no-cache libc6-compat g++ make python3 libvips-dev

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8888

CMD [ "node", "index.js" ]