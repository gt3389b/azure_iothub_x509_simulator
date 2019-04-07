FROM node:10-slim

RUN npm install
RUN npx patch-package
