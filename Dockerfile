FROM node:24-alpine
WORKDIR /opt/giraffe-oracle
COPY package.json pnpm-lock.yaml ./
COPY src ./src
USER node
ENV GIRAFFE_ORACLE_ENV=development
ENV GIRAFFE_ORACLE_HOST=localhost
ENV GIRAFFE_ORACLE_PORT=8780
ENV GIRAFFE_ORACLE_EXTERNAL_WRITES=false
EXPOSE 8780
CMD ["node", "src/main.js"]

