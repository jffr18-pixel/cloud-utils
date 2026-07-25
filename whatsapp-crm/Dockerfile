# CRM de WhatsApp · Burocracia Zero
# Sin dependencias externas: solo Node.js.
FROM node:22-alpine

WORKDIR /app
COPY . .

# Los datos (db, adjuntos y copias) viven fuera de la imagen, en un volumen.
ENV DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server.js"]
