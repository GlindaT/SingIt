// 1. Mantenemos la variable aquí de forma interna
let db = null;

// 2. Creamos una función para que otros módulos puedan obtener la conexión a la DB
export function getDB() {
  return db;
}

// 3. Tu función de inicialización modificada
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
      db = event.target.result; // Se guarda internamente en el módulo
      resolve(db);
    };

    request.onerror = function () {
      reject("❌ Error al abrir IndexedDB");
    };
  });
}
