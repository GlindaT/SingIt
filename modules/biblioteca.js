// Variable interna para la conexión
let db = null;

// Función para compartir la conexión activa con otros módulos
export function getDB() {
  return db;
}

// ==========================================
// INDEXED DB - BIBLIOTECA
// ==========================================
export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("SingItDB", 1);

    request.onupgradeneeded = function (event) {
      const database = event.target.result;

      if (!database.objectStoreNames.contains("library")) {
        const store = database.createObjectStore("library", {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("type", "type", { unique: false });
        store.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = function (event) {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = function () {
      reject("❌ Error al abrir IndexedDB");
    };
  });
}

export function addLibraryItem(item) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const request = store.add(item);

    request.onsuccess = function () {
      resolve();
    };

    request.onerror = function () {
      reject("❌ Error al guardar en IndexedDB");
    };
  });
}

export function getAllLibraryItems() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const request = store.getAll();

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject("❌ Error al leer Biblioteca");
    };
  });
}

export function updateLibraryItem(id, changes) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return reject("Archivo no encontrado");

      const updatedItem = { ...item, ...changes };
      const putReq = store.put(updatedItem);

      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject("Error al actualizar la BD");
    };

    getReq.onerror = () => reject("Error al buscar en BD");
  });
}

export function deleteLibraryItemFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const request = store.delete(id);

    request.onsuccess = function () {
      resolve();
    };

    request.onerror = function () {
      reject("❌ Error al eliminar archivo");
    };
  });
}

export function getLibraryItemsByType(type) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const index = store.index("type");
    const request = index.getAll(type);

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject("❌ Error al filtrar archivos por tipo");
    };
  });
}

export function getLibraryItemById(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const request = store.get(id);

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject("❌ Error al obtener archivo");
    };
  });
}
