// db.js - Local offline storage (IndexedDB) for Somdul.
//
// Two jobs:
//  1. Cache the last-known server state so the app has something to render
//     immediately on load, even with no network at all.
//  2. Queue mutations made while offline (as a call to re-run later — the
//     exact same apiXxx() function + arguments) so they replay against the
//     real REST endpoints once connectivity returns. Money math is never
//     computed locally; the server remains the single source of truth for
//     balances, so a queued "pay credit card" replays as a real API call,
//     not a local balance guess.

const DB_NAME = "somdul-offline";
const DB_VERSION = 1;
const CACHE_STORE = "cache";
const PENDING_STORE = "pendingOps";
const META_STORE = "meta";

let _dbPromise = null;

function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CACHE_STORE)) {
                db.createObjectStore(CACHE_STORE, { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains(PENDING_STORE)) {
                db.createObjectStore(PENDING_STORE, { keyPath: "opId" });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

function tx(storeName, mode) {
    return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ---- cache: last-known state, one row per key ----
async function dbSaveCache(entries) {
    const store = await tx(CACHE_STORE, "readwrite");
    for (const [key, value] of Object.entries(entries)) {
        store.put({ key, value });
    }
    return new Promise((resolve, reject) => {
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
    });
}

async function dbLoadCache() {
    const store = await tx(CACHE_STORE, "readonly");
    const rows = await reqToPromise(store.getAll());
    const result = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
}

// ---- meta: small key/value settings (lastSyncAt, etc.) ----
async function dbGetMeta(key) {
    const store = await tx(META_STORE, "readonly");
    const row = await reqToPromise(store.get(key));
    return row ? row.value : null;
}

async function dbSetMeta(key, value) {
    const store = await tx(META_STORE, "readwrite");
    store.put({ key, value });
    return new Promise((resolve, reject) => {
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
    });
}

// ---- pending ops: queued mutations made while offline ----
async function dbQueueOp(fn, args) {
    const opId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const store = await tx(PENDING_STORE, "readwrite");
    store.put({ opId, fn, args, queuedAt: new Date().toISOString() });
    await new Promise((resolve, reject) => {
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
    });
    return opId;
}

async function dbListPendingOps() {
    const store = await tx(PENDING_STORE, "readonly");
    return reqToPromise(store.getAll());
}

async function dbRemovePendingOp(opId) {
    const store = await tx(PENDING_STORE, "readwrite");
    store.delete(opId);
    return new Promise((resolve, reject) => {
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
    });
}

async function dbPendingCount() {
    const store = await tx(PENDING_STORE, "readonly");
    return reqToPromise(store.count());
}
