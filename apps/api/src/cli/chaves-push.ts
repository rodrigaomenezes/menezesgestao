// npm run push:chaves — gera o par de chaves VAPID dos avisos no celular.
// Copie para as variáveis do serviço (Railway → Variables): VAPID_PUBLICA e VAPID_PRIVADA. Gere uma vez só:
// trocar as chaves desfaz as inscrições dos aparelhos (cada pessoa precisa ligar os avisos de novo).
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.info(["Crie estas variáveis no servidor (não cole em chat nem no código):", "", `VAPID_PUBLICA=${publicKey}`, `VAPID_PRIVADA=${privateKey}`].join("\n"));
