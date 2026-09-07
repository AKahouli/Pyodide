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

# CI host blocks outbound port 80 (only 443 is open) and the slim image has
# no CA bundle, so plain HTTP times out and HTTPS fails TLS verification.
# Bootstrap the CA bundle from the alpine build stage, switch mirrors to
# HTTPS, then install the real ca-certificates package with the first batch.
# CI note: build with --network=host — the runner's bridge network has no
# outbound access at all.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN find /etc/apt -name '*.sources' -o -name 'sources.list' | \
    xargs -r sed -i 's|http://deb.debian.org|https://deb.debian.org|g'

RUN apt-get -o Acquire::Retries=3 update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
      ca-certificates wget gnupg \
      fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
      libxss1 libgtk2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
      chromium \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN apt-get -o Acquire::Retries=3 update && \
    apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
      pandoc texlive texlive-xetex \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash azureuser \
    && chown -R azureuser /usr/src/app

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/modules/conversation/proto ./dist/modules/conversation/proto
COPY --from=build /app/src/modules/conversation-v2/proto ./dist/modules/conversation-v2/proto
COPY --from=build /app/src/modules/playbook-flow/proto ./dist/modules/playbook-flow/proto
COPY --from=build /app/src/modules/agent/proto ./dist/modules/agent/proto
COPY --from=build /app/src/modules/worky/proto ./dist/modules/worky/proto
COPY --from=build /app/src/modules/email/templates ./dist/modules/email/templates
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

USER azureuser
EXPOSE 3000

CMD ["node", "dist/main.js"]