FROM node:16 AS build

WORKDIR /usr/src/app

COPY package.json .
RUN npm install

COPY . .
RUN npm run compile

FROM node:16-alpine

WORKDIR /usr/src/app

COPY package.json .
RUN npm install --production

COPY --from=build /usr/src/app/build build

CMD [ "node", "build/src/index.js" ]
