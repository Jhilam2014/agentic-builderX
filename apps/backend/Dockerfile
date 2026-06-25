FROM node:22-alpine

WORKDIR /workspace/backend
COPY apps/backend/package.json ./
RUN npm install
ARG CODEX_VERSION=0.142.2
RUN npm install -g @openai/codex@${CODEX_VERSION}
COPY apps/backend ./
EXPOSE 8080
CMD ["npm", "run", "dev"]
