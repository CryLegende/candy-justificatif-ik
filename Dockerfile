# Image de l'application : API, interface et generation PDF.
FROM node:24-alpine

WORKDIR /app

# Chromium vient du gestionnaire de paquets, pas du telechargement de Puppeteer : le binaire
# distribue par Puppeteer est lie a la glibc et ne demarre pas sur Alpine, qui utilise musl.
# Les polices sont necessaires, sinon le PDF sort avec des carres a la place du texte.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY server ./server
COPY public ./public

# Le dossier de donnees est un volume : les indemnites, les cartes grises et les justificatifs
# doivent survivre a une reconstruction de l'image.
ENV IK_DOSSIER_DONNEES=/donnees
ENV IK_PORT=3200
VOLUME ["/donnees"]
EXPOSE 3200

# dumb-init n'est pas necessaire : start.js ferme lui-meme Chromium sur SIGTERM.
CMD ["node", "server/start.js"]
