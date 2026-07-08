// Service Worker for PWA
const CACHE_NAME = 'attendance-v1.0.0';
const STATIC_CACHE = 'static-v1.0.0';
const DYNAMIC_CACHE = 'dynamic-v1.0.0';

// Files to cache on install
const urlsToCache = [
    '/',
    '/index.html',
  './manifest.json',
  '/192.png',
  '/512.jpg',
];

// Install event - cache core files
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - network first with cache fallback
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        event.respondWith(fetch(request));
        return;
    }

    // Skip Firebase and external APIs
    if (url.hostname.includes('firebase') || 
        url.hostname.includes('googleapis') ||
        url.hostname.includes('telegram') ||
        url.hostname.includes('gstatic.com')) {
        event.respondWith(fetch(request));
        return;
    }

    // For HTML pages - network first
    if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const clonedResponse = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clonedResponse);
                    });
                    return response;
                })
                .catch(() => {
                    return caches.match(request)
                        .then(cachedResponse => {
                            if (cachedResponse) return cachedResponse;
                            return caches.match('/index.html');
                        });
                })
        );
        return;
    }

    // For static assets - cache first
    if (url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|woff2|ico)$/)) {
        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {
                    if (cachedResponse) {
                        // Update cache in background
                        fetch(request).then(response => {
                            if (response && response.status === 200) {
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(request, response);
                                });
                            }
                        }).catch(() => {});
                        return cachedResponse;
                    }
                    return fetch(request)
                        .then(response => {
                            if (response && response.status === 200) {
                                const clonedResponse = response.clone();
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(request, clonedResponse);
                                });
                            }
                            return response;
                        })
                        .catch(() => {
                            // Return offline fallback
                            if (request.url.endsWith('.css')) {
                                return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
                            }
                            if (request.url.endsWith('.js')) {
                                return new Response('console.log("Offline")', { 
                                    status: 200,
                                    headers: { 'Content-Type': 'application/javascript' }
                                });
                            }
                            if (request.url.endsWith('.png') || request.url.endsWith('.jpg') || request.url.endsWith('.svg')) {
                                return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
                            }
                        });
                })
        );
        return;
    }

    // Default - network first
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response && response.status === 200) {
                    const clonedResponse = response.clone();
                    caches.open(DYNAMIC_CACHE).then(cache => {
                        cache.put(request, clonedResponse);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(request);
            })
    );
});

// Handle background sync
self.addEventListener('sync', event => {
    if (event.tag === 'sync-attendance') {
        event.waitUntil(syncAttendance());
    }
});

// Handle push notifications
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = {
            title: 'ระบบลงเวลาเรียน',
            body: 'มีการแจ้งเตือนใหม่',
            url: '/'
        };
    }
    
    const options = {
        body: data.body || 'มีการแจ้งเตือนใหม่',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/'
        },
        actions: [
            {
                action: 'open',
                title: 'เปิดแอป'
            },
            {
                action: 'close',
                title: 'ปิด'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'ระบบลงเวลาเรียน', options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
    const notification = event.notification;
    const action = event.action;
    
    notification.close();
    
    if (action === 'close') {
        return;
    }
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Check if there's already a window/tab open with the target URL
                const url = notification.data.url || '/';
                for (let i = 0; i < windowClients.length; i++) {
                    const client = windowClients[i];
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If not, open a new window/tab
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Sync attendance function
async function syncAttendance() {
    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();
        
        for (const request of requests) {
            if (request.url.includes('/attendance')) {
                const response = await cache.match(request);
                if (response) {
                    const data = await response.json();
                    // Send to server
                    await fetch('/api/attendance/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    await cache.delete(request);
                }
            }
        }
        console.log('[SW] Sync completed successfully');
    } catch (error) {
        console.error('[SW] Sync failed:', error);
    }
}

// Handle message from client
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Handle offline analytics
self.addEventListener('error', function(event) {
    console.log('[SW] Error caught:', event.message);
});

console.log('[SW] Service Worker loaded successfully');