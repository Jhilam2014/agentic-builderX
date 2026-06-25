FROM node:22-alpine

WORKDIR /workspace/frontend
COPY apps/frontend/package.json ./
RUN npm install
COPY apps/frontend ./
EXPOSE 5173
CMD ["npm", "run", "dev"]
