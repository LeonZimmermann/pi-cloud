FROM nginx:alpine

RUN apk add --no-cache openssl \
 && rm -f /etc/nginx/conf.d/default.conf \
 && rm -rf /usr/share/nginx/html/* \
 && mkdir -p /data

COPY nginx/nginx.conf.template /etc/nginx/pi-cloud.conf.template
COPY nginx/pi-cloud-auth.js /etc/nginx/njs/pi-cloud-auth.js
COPY --chmod=755 nginx/40-pi-cloud.sh /docker-entrypoint.d/40-pi-cloud.sh
COPY app/ /usr/share/nginx/html/

VOLUME ["/data"]
EXPOSE 80 443
