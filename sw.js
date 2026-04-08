/* ================================================================
   SERVICE WORKER — Monitor de Ancho de Banda
   - Cache-first para uso offline
   - Periodic Background Sync (Chrome Android con PWA instalada)
   - Manejo de notificaciones push y clicks
   ================================================================ */

const CACHE  = 'bwmon-v1';
const ASSETS = [
  './monitor-red.html',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js'
];

/* ── Instalación: pre-cachear recursos ── */
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }).catch(function(){})
  );
  self.skipWaiting();
});

/* ── Activación: limpiar caches viejos ── */
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

/* ── Fetch: cache-first con fallback a red ── */
self.addEventListener('fetch', function(e){
  if(e.request.method!=='GET') return;
  /* No interceptar peticiones de medición */
  if(e.request.url.includes('speed.cloudflare.com')||
     e.request.url.includes('ipinfo.io')||
     e.request.url.includes('ip-api.com')) return;

  e.respondWith(
    caches.match(e.request).then(function(cached){
      if(cached) return cached;
      return fetch(e.request).then(function(res){
        if(res&&res.ok){
          var clone=res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request,clone); });
        }
        return res;
      }).catch(function(){ return cached; });
    })
  );
});

/* ── Periodic Background Sync (Chrome Android + PWA instalada) ──
   Realiza un ping liviano y notifica si la latencia es alta.
   Requiere que el usuario haya instalado la PWA y concedido permiso.    */
self.addEventListener('periodicsync', function(e){
  if(e.tag==='bw-ping-check') e.waitUntil(bgPingCheck());
});

async function bgPingCheck(){
  try{
    var t0=Date.now();
    var res=await fetch('https://speed.cloudflare.com/__down?bytes=1&_sw='+t0,
                        {cache:'no-store',mode:'cors'});
    await res.blob();
    var ping=Date.now()-t0;

    /* Avisar a las ventanas abiertas */
    var clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    clients.forEach(function(c){ c.postMessage({type:'SW_BG_PING',ping:ping}); });

    /* Si el ping es muy alto, mostrar notificación */
    if(ping>500){
      await self.registration.showNotification('⚠️ Latencia alta detectada',{
        body:'Ping: '+ping+' ms — posible degradación de la conexión.',
        icon:'./icon-192.png', badge:'./icon-192.png',
        tag:'bwmon-ping', renotify:true,
        data:{url:'./monitor-red.html'}
      });
    }
  }catch(err){ /* sin conexión — ignorar */ }
}

/* ── Click en notificación: abrir/enfocar la app ── */
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target=(e.notification.data&&e.notification.data.url)||'./monitor-red.html';
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(clients){
      for(var i=0;i<clients.length;i++){
        if(clients[i].url.includes('monitor-red')&&'focus' in clients[i])
          return clients[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

/* ── Mensajes desde la página principal ── */
self.addEventListener('message', function(e){
  if(!e.data) return;
  /* Registro de Periodic Background Sync solicitado desde la página */
  if(e.data.type==='REGISTER_PERIODIC_SYNC'){
    self.registration.periodicSync.register('bw-ping-check',{
      minInterval: e.data.interval || 15*60*1000   /* 15 min por defecto */
    }).catch(function(){});
  }
});
