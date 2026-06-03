"use strict";
// Installs a global `indexedDB` backed by fake-indexeddb.
require("fake-indexeddb/auto");

// Delete a database by name and wait for completion — used to isolate tests.
function deleteDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // no other connections in tests
  });
}

module.exports = { deleteDB };
