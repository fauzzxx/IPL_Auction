FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/
RUN npm install && npm install --prefix client && npm install --prefix server
COPY . .
ENV DATABASE_URL="file:./arena.db"
ENV HOST=0.0.0.0
RUN npm run db --prefix server && npm run build
EXPOSE 4000
CMD ["npm", "start"]
