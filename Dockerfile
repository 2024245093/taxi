FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

COPY . .

EXPOSE 5000
CMD ["npm", "start"]
