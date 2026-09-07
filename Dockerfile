# ═══════════════════════════════════════════════════════════
#  AGE OF GENERATION — Abbild fuer den Betrieb im Container
#
#  Es gibt nichts zu uebersetzen und nichts zu installieren:
#  Der Server braucht nur Node, alles andere liegt im Ordner.
#  Deshalb ein einziger, sehr kleiner Bauabschnitt.
# ═══════════════════════════════════════════════════════════
FROM node:22-alpine

WORKDIR /app

# Nur, was im Betrieb gebraucht wird.
COPY package.json server.js partien.js index.html ./
COPY css ./css
COPY js ./js
COPY README.md ./

# Aufzeichnungen liegen in einem eigenen Ordner, der als
# Datentraeger eingehaengt wird — sonst waeren sie beim
# naechsten Abbild weg.
RUN mkdir -p /app/daten/replays && chown -R node:node /app/daten

USER node
ENV PORT=3000 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/gesundheit >/dev/null || exit 1

CMD ["node", "server.js"]
