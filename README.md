# Pi Cloud

Schlanker OneDrive- und Google-Fotos-Ersatz für den Raspberry Pi: ein einziger nginx-Container, kein Backend, keine Datenbank. Die Dateien bleiben auf dem Pi, die Geräte laden nur, was du öffnest.

## Funktionen

**Dateien:** Dateibaum mit den Bereichen *Meine Dateien* (nur für dich) und *Familie* (für alle Benutzer). Du kannst:
- als Liste oder in Kacheln anzeigen,
- hochladen (mehrere Dateien und ganze Ordner, am Desktop auch per Drag & Drop),
- neue Ordner anlegen, umbenennen, verschieben (auch zwischen *Meine Dateien* und *Familie*), löschen, herunterladen,
- mehrere Elemente gleichzeitig auswählen.

**Fotos:** Alle Bilder und Videos aus `Bilder/` in deinem Bereich und in `Familie/Bilder/`.
- *Alle Fotos* zeigt sie nach Monaten gruppiert, neueste zuerst. Das Datum stammt aus dem Dateinamen (z. B. `IMG_20260712_…`), sonst wird das Änderungsdatum genommen.
- *Alben* sind die Unterordner von `Bilder/`, persönlich oder für die Familie. Fotos kannst du einzeln oder per Mehrfachauswahl in ein Album verschieben oder wieder herausnehmen. Ein Album lässt sich auflösen (die Fotos bleiben erhalten) oder komplett löschen.
- Weil Alben normale Ordner sind, siehst du sie genauso im Dateibaum, per Samba und in Syncthing.

**Betrachter:**
- Bildergalerie mit Wischen, Pinch- und Doppeltipp-Zoom
- PDF-Viewer (pdf.js, lokal mitgeliefert)
- Video- und Audio-Player
- Textvorschau

**App:** installierbar auf iPhone, iPad und Android.

## Speicheraufbau

```
/data/                    (dein Ordner auf dem Pi, z. B. /mnt/daten/cloud)
├── users/
│   ├── leon/             „Meine Dateien“ von leon
│   │   └── Bilder/       leons Fotos, Unterordner = persönliche Alben
│   └── anna/
└── shared/               „Familie“, für alle Benutzer les- und schreibbar
    └── Bilder/           Familienfotos, Unterordner = gemeinsame Alben
```

Jeder Benutzer sieht nur seinen eigenen Ordner und `shared/`. Die Trennung macht nginx anhand der Anmeldung, die App kann sie nicht umgehen. Ordner für neue Benutzer legt der Container beim Start an.

## Installation

1. Den Ordner `pi-cloud/` neben deine `docker-compose.yml` legen.
2. Den Dienst aus `docker-compose.example.yml` übernehmen und dort anpassen:
   - den Datenpfad,
   - die Benutzer,
   - `PUID`/`PGID` (die Werte von `id -u` und `id -g` des Benutzers, dem die Dateien gehören).
3. Die Passwörter in die `.env` neben der Compose-Datei schreiben:

   ```
   PI_CLOUD_PW_LEON=…
   PI_CLOUD_PW_ANNA=…
   ```

4. Starten:

   ```bash
   docker compose up -d --build pi-cloud
   docker compose logs pi-cloud      # zeigt Benutzer, UID und ob Vorschaubilder aktiv sind
   ```

### Vorhandene Daten übernehmen

Beispiel: Deine bisherigen OneDrive-Daten liegen in `/mnt/daten/onedrive`, die Cloud soll künftig unter `/mnt/daten/cloud` liegen:

```bash
docker compose stop pi-cloud
sudo mkdir -p /mnt/daten/cloud/users /mnt/daten/cloud/shared
sudo mv /mnt/daten/onedrive /mnt/daten/cloud/users/leon     # wird „Meine Dateien“ von leon
sudo chown -R 1000:1000 /mnt/daten/cloud
docker compose up -d pi-cloud
```

Liegen deine Fotos in einem Ordner mit anderem Namen, z. B. `Pictures`, benennst du ihn in `Bilder` um oder setzt `PHOTOS_FOLDER: Pictures`. Der Name gilt dann für alle Bereiche.

Wichtig: Binde `/data` als **einen** Ordner ein, nicht `users/…` und `shared` einzeln. Sonst sind es für Linux verschiedene Laufwerke. Dann müssen Dateien beim Verschieben zwischen persönlich und Familie kopiert werden, und ganze Ordner lassen sich gar nicht zwischen den Bereichen verschieben.

## Auf Handy und Tablet installieren (HTTPS über Tailscale)

```bash
sudo tailscale serve --bg 8080
```

Danach ist die App unter `https://<pi-name>.<tailnet>.ts.net` erreichbar, mit gültigem Zertifikat.

So installierst du sie:
- **iPhone/iPad:** in Safari öffnen, auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.
- **Android:** in Chrome über das Menü ⋮ „App installieren“ wählen, oder im App-Menü ⋯ „App installieren“.

Jede Person meldet sich einmal auf ihrem Gerät an. Das Login-Cookie gilt ein Jahr. Wenn sich ein Passwort ändert, wird nur diese Person abgemeldet.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `CLOUD_USERS` | – | Benutzer, eine Zeile (oder durch Komma getrennt) `name:passwort` pro Person |
| `CLOUD_USERS_FILE` | – | Wie `CLOUD_USERS`, aber aus einer Datei (z. B. Docker-Secret) |
| `CLOUD_USER` / `CLOUD_PASSWORD` | – | Alternative für genau einen Benutzer |
| `SHARED_NAME` | `Familie` | Anzeigename des gemeinsamen Bereichs |
| `PHOTOS_FOLDER` | `Bilder` | Fotoordner in jedem Bereich |
| `PUID` / `PGID` | `1000` | Mit dieser UID/GID schreibt nginx in `/data` |
| `THUMBNAILS` | `on` | Vorschaubilder serverseitig erzeugen (`off` liefert Originale aus) |
| `THUMB_CACHE` | `1g` | Maximale Größe des Vorschaubild-Caches |
| `SESSION_SECRET` | leer | Ändern, um alle Geräte abzumelden |
| `TLS_CERT` / `TLS_KEY` | – | Zertifikat und Schlüssel (PEM). Gesetzt, lauscht nginx zusätzlich auf Port 443 (HTTPS). Fehlen die Dateien, wird ein selbstsigniertes Zertifikat erzeugt |
| `TLS_HOSTNAMES` | `raspberrypi` | Hostnamen (durch Leerzeichen getrennt) für das selbstsignierte Ersatz-Zertifikat |

Benutzernamen bestehen aus Kleinbuchstaben, Ziffern und `. _ -`. Passwörter dürfen kein Komma enthalten, wenn du die Komma-Schreibweise nutzt.

## Gut zu wissen

- **Ressourcen:** Im Leerlauf braucht der Container nur wenige MB RAM.
  - Ein Vorschaubild wird beim ersten Aufruf einmal berechnet und dann im Cache gehalten.
  - Sehr große Fotos (ab etwa 40 MP) können kurzzeitig einige hundert MB RAM brauchen.
  - Die Fotos-Ansicht liest beim Öffnen die Ordnerlisten von `Bilder/` ein. Das sind nur kleine JSON-Abfragen, auch bei tausenden Fotos schnell.
- **Uploads** landen zuerst im Cache-Volume und werden dann nach `/data` verschoben.
- **Versteckte Dateien** (beginnend mit `.`, z. B. `.stfolder` von Syncthing) blendet die App aus.
- **HEIC-Fotos** vom iPhone zeigt nur Safari an, andere Browser bieten sie zum Download an.
- **Ordner** lassen sich nicht als ZIP herunterladen, einzelne und mehrere Dateien schon.
- **Direkter Zugriff:** Mit Benutzer und Passwort funktionieren `curl` und einfache WebDAV-Clients unter `/files/home/…` und `/files/shared/…`. Zum Einbinden ins Dateisystem bleibt Samba die bessere Wahl.
- **Port 8080 nicht ins Internet freigeben.** Der Zugriff von unterwegs läuft über Tailscale.

## Aufbau

```
Dockerfile                     nginx:alpine + App + Startskript
nginx/40-pi-cloud.sh           erzeugt beim Start Benutzer, Tokens, Bereiche, config.json und nginx.conf
nginx/nginx.conf.template      /files/ (autoindex JSON + WebDAV, je Benutzer), /thumb/ (image_filter + Cache), /api/*
app/                           Web-App (HTML/CSS/JS, Service Worker, Manifest, Icons, vendor/pdfjs)
```
# pi-cloud
