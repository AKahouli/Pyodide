FROM node:20-alpine AS build
WORKDIR /app


COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY nest-cli.json tsconfig.json tsconfig.build.json ./

RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /usr/src/app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV BROWSER_SESSION_CHROMIUM_PATH=/usr/bin/chromium

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wget gnupg \
      fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
      libxss1 libgtk2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
      chromium \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      pandoc texlive texlive-xetex \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash azureuser \
    && chown -R azureuser /usr/src/app
    
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/modules/conversation/proto ./dist/modules/conversation
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

USER azureuser
EXPOSE 3000

CMD ["node", "dist/main.js"]
