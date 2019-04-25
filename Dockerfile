FROM node:10-slim

#RUN npx patch-package

WORKDIR /app


# Add your source files
COPY device/ .  
RUN rm -r node_modules
RUN npm install
RUN ls
RUN cat package.json
CMD ["npm","start"]  
