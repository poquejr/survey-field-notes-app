/* IndexedDB helpers. Photos, sketches, and signatures are blobs in `files`.
   Day metadata lives in `kv`. Do not store images in localStorage. */
(function (global) {
  "use strict";

  var DB_NAME = "field-notes";
  var DB_VER = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var result;
        try { result = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error("aborted")); };
        if (result && typeof result === "object" && "onsuccess" in result) {
          result.onsuccess = function () { result = result.result; };
          result.onerror = function () { reject(result.error); };
        }
      });
    });
  }

  function kvGet(key) {
    return tx("kv", "readonly", function (s) { return s.get(key); });
  }
  function kvSet(key, value) {
    return tx("kv", "readwrite", function (s) { return s.put(value, key); });
  }
  function filePut(record) {
    return tx("files", "readwrite", function (s) { return s.put(record); });
  }
  function fileGet(id) {
    return tx("files", "readonly", function (s) { return s.get(id); });
  }
  function fileDelete(id) {
    return tx("files", "readwrite", function (s) { return s.delete(id); });
  }
  function fileGetAll() {
    return tx("files", "readonly", function (s) { return s.getAll(); });
  }

  global.FNIdb = {
    open: open,
    kvGet: kvGet,
    kvSet: kvSet,
    filePut: filePut,
    fileGet: fileGet,
    fileDelete: fileDelete,
    fileGetAll: fileGetAll
  };
})(window);
