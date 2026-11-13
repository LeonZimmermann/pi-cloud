#!/bin/sh
# Bereitet nginx beim Containerstart vor: Worker-Benutzer mit PUID/PGID,
# Benutzerkonten, Login-Tokens, Speicherbereiche und nginx.conf.
set -eu

TEMPLATE=/etc/nginx/pi-cloud.conf.template
CONF=/etc/nginx/nginx.conf
HTPASSWD=/etc/nginx/.htpasswd
SESSIONS=/etc/nginx/pi-cloud-sessions.map
LOGINS=/etc/nginx/pi-cloud-logins.map
MODULE=/etc/nginx/modules/ngx_http_image_filter_module.so
HTML=/usr/share/nginx/html
SPACES=/srv/spaces

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
THUMBNAILS="${THUMBNAILS:-on}"
THUMB_CACHE="${THUMB_CACHE:-1g}"
SHARED_NAME="${SHARED_NAME:-Familie}"
PHOTOS_FOLDER="${PHOTOS_FOLDER:-Bilder}"

log() { echo "pi-cloud: $*"; }
die() { log "FEHLER: $*" >&2; exit 1; }

# Benutzerliste: CLOUD_USERS (eine Zeile oder ein Komma pro Benutzer,
# jeweils name:passwort), alternativ CLOUD_USERS_FILE oder für einen
# einzelnen Benutzer CLOUD_USER + CLOUD_PASSWORD.
users="${CLOUD_USERS:-}"
if [ -n "${CLOUD_USERS_FILE:-}" ]; then
    [ -r "$CLOUD_USERS_FILE" ] || die "CLOUD_USERS_FILE ($CLOUD_USERS_FILE) ist nicht lesbar."
    users="$(cat "$CLOUD_USERS_FILE")"
fi
if [ -z "$users" ] && [ -n "${CLOUD_PASSWORD:-}" ]; then
    users="${CLOUD_USER:-admin}:$CLOUD_PASSWORD"
fi
[ -n "$users" ] || die "Keine Benutzer konfiguriert. CLOUD_USERS setzen (name:passwort pro Zeile)."

case "$PHOTOS_FOLDER" in */*|""|.|..) die "PHOTOS_FOLDER muss ein einfacher Ordnername sein." ;; esac

# nginx-Worker laufen mit derselben UID/GID wie der Besitzer der Daten.
group="$(getent group "$PGID" | cut -d: -f1 || true)"
if [ -z "$group" ]; then
    addgroup -g "$PGID" picloud
    group=picloud
fi
wuser="$(getent passwd "$PUID" | cut -d: -f1 || true)"
if [ -z "$wuser" ]; then
    adduser -D -H -u "$PUID" -G "$group" -s /sbin/nologin picloud
    wuser=picloud
fi

: > "$HTPASSWD"; : > "$SESSIONS"; : > "$LOGINS"
rm -rf "$SPACES"
mkdir -p /data/users /data/shared "$SPACES"

printf '%s\n' "$users" | tr ',' '\n' | while IFS= read -r line; do
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    name="${line%%:*}"
    pass="${line#*:}"
    [ "$name" != "$line" ] && [ -n "$pass" ] || die "Ungültiger Eintrag '$name' – Format ist name:passwort."
    printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9_.-]{0,31}$' \
        || die "Ungültiger Benutzername '$name' (erlaubt: a-z, 0-9, . _ -; Kleinbuchstaben)."
    grep -q "^$name:" "$HTPASSWD" && die "Benutzer '$name' ist doppelt eingetragen."

    if command -v openssl >/dev/null 2>&1; then
        hash="$(openssl passwd -apr1 "$pass")"
    else
        hash="{PLAIN}$pass"
    fi
    printf '%s:%s\n' "$name" "$hash" >> "$HTPASSWD"

    # Stabiles Token: ändert sich mit Passwort oder SESSION_SECRET.
    token="$(printf 'pi-cloud:%s:%s:%s' "$name" "$pass" "${SESSION_SECRET:-}" | sha256sum | cut -c1-48)"
    printf '    "%s" %s;\n' "$token" "$name" >> "$SESSIONS"
    printf '    %s %s;\n' "$name" "$token" >> "$LOGINS"

    mkdir -p "/data/users/$name" "$SPACES/$name/files"
    ln -s "/data/users/$name" "$SPACES/$name/files/home"
    ln -s /data/shared "$SPACES/$name/files/shared"
done

chown "root:$group" "$HTPASSWD"
chmod 640 "$HTPASSWD"
chown "$PUID:$PGID" /data/users /data/shared
for d in /data/users/*; do
    [ -d "$d" ] && [ "$(stat -c %u "$d")" = 0 ] && chown "$PUID:$PGID" "$d"
done

# Einstellungen für die Web-App
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
printf '{"sharedName":"%s","photosFolder":"%s"}\n' \
    "$(json_escape "$SHARED_NAME")" "$(json_escape "$PHOTOS_FOLDER")" > "$HTML/config.json"

if [ "$THUMBNAILS" = "on" ] && [ -f "$MODULE" ]; then
    thumbs=on
    load="load_module $MODULE;"
else
    thumbs=off
    load=""
fi

sed -e "s|__WORKER_USER__|$wuser|g" \
    -e "s|__WORKER_GROUP__|$group|g" \
    -e "s|__THUMB_CACHE__|$THUMB_CACHE|g" \
    -e "s|^#@LOAD_IMAGE_FILTER@|$load|" \
    "$TEMPLATE" > "$CONF.tmp"
if [ "$thumbs" = on ]; then
    sed -i -e '/#@IF_NOTHUMBS@/,/#@END_NOTHUMBS@/d' -e '/#@IF_THUMBS@/d' -e '/#@END_THUMBS@/d' "$CONF.tmp"
else
    sed -i -e '/#@IF_THUMBS@/,/#@END_THUMBS@/d' -e '/#@IF_NOTHUMBS@/d' -e '/#@END_NOTHUMBS@/d' "$CONF.tmp"
fi
mv "$CONF.tmp" "$CONF"

mkdir -p /var/cache/nginx/upload /var/cache/nginx/thumbs
chown -R "$PUID:$PGID" /var/cache/nginx

if ! su -s /bin/sh "$wuser" -c 'test -w /data/shared' 2>/dev/null; then
    log "WARNUNG: /data ist für UID $PUID nicht beschreibbar. PUID/PGID prüfen." >&2
fi

log "Benutzer: $(cut -d: -f1 "$HTPASSWD" | tr '\n' ' ')| Worker-UID $PUID:$PGID | Vorschaubilder: $thumbs"
