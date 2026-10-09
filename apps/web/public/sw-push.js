// Avisos no celular (Web Push), carregado pelo service worker gerado pelo Workbox.
// O conteúdo vem cifrado do servidor; o link é sempre um caminho do próprio app.
self.addEventListener("push", (evento) => {
  let d = {};
  try {
    d = evento.data ? evento.data.json() : {};
  } catch {
    d = {};
  }
  const link = typeof d.link === "string" && d.link.startsWith("/") && !d.link.startsWith("//") ? d.link : "/";
  evento.waitUntil(
    self.registration.showNotification(typeof d.titulo === "string" ? d.titulo : "Novo aviso", {
      body: typeof d.texto === "string" ? d.texto : "",
      tag: typeof d.tag === "string" ? d.tag : undefined,
      icon: "/icones/icone-192.png",
      badge: "/icones/icone-192.png",
      data: { link },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const link = (evento.notification.data && evento.notification.data.link) || "/";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ("focus" in janela) {
          janela.navigate(link);
          return janela.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
