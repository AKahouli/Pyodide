FROM node:22.14.0-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./   
RUN npm ci --ignore-scripts
COPY public ./public
COPY src ./src
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json tsconfig.node.json ./
RUN npm run build

FROM nginx:stable-alpine-slim
RUN rm -rf /usr/share/nginx/html/* \
    && rm -rf /etc/nginx/conf.d/* \
    && adduser -D metafront \
    && chmod -R g+w /var/cache/nginx/ && chown -R metafront /var/cache/nginx/ \
    && chmod -R g+w /var/run/ && chown -R metafront /var/run/

COPY --from=builder --chown=root --chmod=755 /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY env.sh /docker-entrypoint.d/env.sh
RUN chmod +x /docker-entrypoint.d/env.sh && \
    chmod -R g+w /usr/share/nginx/html && \
    chown -R metafront /usr/share/nginx/html
    
USER metafront
EXPOSE 80
