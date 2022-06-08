importScripts('https://cdn.jsdelivr.net/npm/idb@7/build/umd.js')
const VERSION = 1;
const SITE_CACHE = `site-${VERSION}`
const OFFLINE_CACHE = `offline-${VERSION}`;
const cacheFiles = [
    '/',
    '/sw/icon.png',
    '/manifest.json',
    '/favicon.ico'
];
const cachingDomains = [
    self.location.hostname,
    'fonts.googleapis.com',
    'fonts.gstatic.com',
];
const IDB_SETTINGS_TABLE = 'settings'

const OFFLINE_DATA_URL = '/offline-data.json'

let downloadOfflineAbort = null

const Console = {
    Log: function () {
        console.log('%c[SW]', 'color:#0043ce;font-weight: bold;', ...arguments)
    },
    Error: function () {
        console.error('%c[SW]', 'color:red;font-weight: bold;', ...arguments)
    },
    Warn: function () {
        console.warn('%c[SW]', 'color:orange;font-weight: bold;', ...arguments)
    },
    Debug: function () {
        console.debug('%c[SW]', 'color:#00bcd4;font-weight: bold;', ...arguments)
    },
}

function getDB() {
    return idb.openDB('offline', VERSION, {
        upgrade(db, oldVersion, newVersion) {
            Console.Log(`Upgrading to version ${newVersion}`);
            const settings = db.createObjectStore(IDB_SETTINGS_TABLE, {
                keyPath: 'key',
            })
            settings.put({
                key: 'enable-offline',
                value: false,
            })
            settings.put({
                key: 'last-check-updates',
                value: null,
            })
        },
        blocked() {
            Console.Warn('Request was blocked')
        },
        blocking() {
            Console.Warn('Request blocking')
        }
    })
}

const settings = {
    get: (key) => getDB().then(db => db.get(IDB_SETTINGS_TABLE, key)),
    set: (key, value) => getDB().then(db => db.put(IDB_SETTINGS_TABLE, {key, value, updated: new Date()})),
}

const fetchAndCache = (evt, cache_name = SITE_CACHE) => {
    return fetch(evt.request).then(response => {
        if (
            response.ok
            && !evt.request.url.startsWith(self.location.origin + '/_next/image')
        ) {
            evt.waitUntil(caches.open(cache_name).then(cache => cache.put(evt.request, response.clone())))
        }
        return response.clone()
    }).catch(() => caches.open(cache_name).then(cache => cache.match(evt.request)))
}

self.addEventListener('message', (event) => {
    Console.Debug('onMessage', event)
    if (event.data && event.data.action === 'enable-offline') {
        event.waitUntil(turnOnOffline())
    } else if (event.data && event.data.action === 'continue-download') {
        event.waitUntil(settings.get('enable-offline').then(v => v.value && downloadOffline(false)))
    } else if (event.data && event.data.action === 'disable-offline') {
        event.waitUntil(turnOffOffline())
    }
});

/**
 *
 * @param {boolean} force_update
 * @returns {Promise<{pages:Array<{url:string,updated:number,files:string[]}>}>}
 */
function fetchOfflineData(force_update = false) {
    const update = () => fetch(OFFLINE_DATA_URL, {cache: "no-cache"}).then(async (response) => {
        await Promise.all([
            caches.open(SITE_CACHE).then(cache => cache.put(OFFLINE_DATA_URL, response.clone())),
            settings.set('last-check-updates', new Date())
        ])
        return await response.clone().json()
    })
    if (force_update)
        return update()
    return caches.open(SITE_CACHE)
        .then(cache => cache.match(OFFLINE_DATA_URL))
        .then(data => data.json())
        .catch(() => update())
}

async function downloadOffline(update) {
    const data = await fetchOfflineData(update)
    let files = (data.pages || []).reduce((array, page) => {
        array.push(page.url, ...page.files)
        return array
    }, []);
    files = [...new Set(files)]

    if (downloadOfflineAbort) {
        downloadOfflineAbort.abort()
    }
    downloadOfflineAbort = new AbortController()

    Console.Debug('Files from offline data: ', files)

    const cache = await caches.open(OFFLINE_CACHE)
    const cachedFiles = await cache.keys().then(requests => requests.map(r => new URL(r.url)).map(url => url.pathname + url.search))

    Console.Debug('Files in cache now: ', cachedFiles)
    const result = {
        toDownload: files.filter(f => !cachedFiles.includes(f)),
        toDelete: cachedFiles.filter(f => !files.includes(f)),
    }
    Console.Debug('Result map files: ', result)
    const broadcast = new BroadcastChannel('offline-download')
    const status = {
        downloaded: 0,
        download_failed: 0,
        deleted: 0,
        toDownload: result.toDownload.length,
        toDelete: result.toDelete.length,
    }
    broadcast.postMessage({
        status: 'start',
        data: status,
    })
    const infoBroadcast = setInterval(() => {
        broadcast.postMessage({
            status: 'downloading',
            data: status
        })
    }, 1000);
    return await Promise.allSettled([
        Promise.allSettled(
            result.toDownload.map(
                f => new Request(f, {
                    signal: downloadOfflineAbort.signal,
                    cache: "no-store",
                })
            )
                .map(
                    f => cache.add(f)
                        .then(() => status.downloaded++)
                        .catch(() => status.download_failed++)
                )
        ).then(() => downloadOfflineAbort = null),
        Promise.allSettled(
            result.toDelete.map(
                f => cache.delete(f)
                    .then(() => status.deleted++)
            )
        )
    ]).then(() => {
        clearInterval(infoBroadcast)
        broadcast.postMessage({
            status: 'done',
            data: status,
        })
    })
}

function turnOnOffline() {
    return Promise.all([
        settings.set('enable-offline', true),
        downloadOffline(true),
        self.clients.matchAll({type: 'window'}).then(tabs => tabs.forEach(tab => tab.navigate(tab.url)))
    ])
}

async function turnOffOffline() {
    if(downloadOfflineAbort) {
        downloadOfflineAbort.abort()
        downloadOfflineAbort = null
    }
    return Promise.all([
        settings.set('enable-offline', false),
        caches.delete(OFFLINE_CACHE)
    ])
}

self.addEventListener('fetch', evt => {
    const url = new URL(evt.request.url)
    if (!cachingDomains.includes(url.hostname)) return;
    evt.respondWith(async function () {
        if (url.hostname === self.location.hostname) {
            if (url.pathname.startsWith('/_next/static/chunks/pages/')) {
                return await fetch(evt.request)
            }

            if (url.pathname.startsWith('/_next/static/') || cacheFiles.includes(url.pathname)) {
                return await fetchAndCache(evt)
            }

            if ((await settings.get('enable-offline') || {}).value)
                return await fetchAndCache(evt, OFFLINE_CACHE).then(async (result) => {
                    if (result) return result;
                    if (!result && url.pathname === '/_next/image') {
                        let startUrl = new URL(url)
                        startUrl.searchParams.delete('w')
                        startUrl.searchParams.delete('q')
                        startUrl = startUrl.href
                        return await caches.open(OFFLINE_CACHE)
                            .then(cache => cache.matchAll('/_next/image', {ignoreSearch: true}))
                            .then(files => files.find(f => f.url.startsWith(startUrl)))
                    }
                    return result
                })

            return await fetch(evt.request)
        } else {
            return await fetchAndCache(evt)
        }
    }())
});


self.addEventListener('install', evt =>
    evt.waitUntil(
        caches.open(SITE_CACHE).then(cache => {
            return cache.addAll(cacheFiles);
        }).then(() => self.skipWaiting())
    )
);

self.addEventListener('activate', evt =>
    evt.waitUntil(Promise.all([
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (![SITE_CACHE, OFFLINE_CACHE].includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }),
        getDB(),
        self.clients.claim()
    ]))
);

/**
 * Background download offline pages
 */
self.addEventListener('backgroundfetchsuccess', evt => {
    Console.Log('backgroundfetchsuccess', evt)
    const bgFetch = evt.registration
    if (bgFetch.id === 'offline-download') {
        evt.waitUntil(async function () {
            const cache = await caches.open(OFFLINE_CACHE);
            const records = await bgFetch.matchAll();

            const promises = records.map(async record => {
                await cache.put(record.request, await record.responseReady);
            });

            await Promise.all(promises);

            evt.updateUI({title: 'Offline ВзяємоДія готова!'});
            new BroadcastChannel(bgFetch.id).postMessage({stored: true});
        }())
    }
})
self.addEventListener('backgroundfetchfail', event => {
    Console.Log('Background fetch failed', event);
});
self.addEventListener('backgroundfetchclick', event => {
    clients.openWindow('/');
});
