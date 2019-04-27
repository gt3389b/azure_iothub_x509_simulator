FROM node:10-slim

#RUN npx patch-package

WORKDIR /app


# Add your source files
COPY src .  
RUN rm -r node_modules
RUN npm install
CMD ["npm","start"]  
