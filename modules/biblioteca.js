import { $ } from '../script.js';

// Variable interna exclusiva para sostener la conexión a la base de datos
let db = null;

/**
 * Función exportable imprescindible para que otros módulos compartan la conexión activa a la DB
 */
export function getDB() {
  return db;
}

// ==========================================
// MOTOR CRUD - INDEXED DB
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
    if (!db) return reject("Base de datos no inicializada");
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
    if (!db) return reject("Base de datos no inicializada");
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
    if (!db) return reject("Base de datos no inicializada");
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
    if (!db) return reject("Base de datos no inicializada");
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
    if (!db) return reject("Base de datos no inicializada");
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
    if (!db) return reject("Base de datos no inicializada");
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

// ==========================================
// CAPA INTERFAZ VISUAL - BIBLIOTECA
// ==========================================

/**
 * Función puente optimizada para guardar archivos y recargar la vista visual
 */
export async function saveToLibrary(blob, options = {}) {
  try {
    await addLibraryItem({
      name: options.name || "Archivo",
      type: options.type || "audio",
      audioBlob: blob || null, 
      textoPlano: options.textoPlano || null, 
      date: new Date().toLocaleString("es-ES"),
      transcription: options.transcription || [] 
    });

    await renderLibrary(options.type || 'todos');
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo guardar en Biblioteca");
  }
}

/**
 * Renderiza de forma asíncrona las carpetas y las tarjetas multimedia
 */
export async function renderLibrary(filter = 'todos') {
  const container = $("libraryList");
  if (!container) return;

  document.querySelectorAll(".folder-btn").forEach(btn => {
    const clickAttr = btn.getAttribute("onclick") || "";
    if (clickAttr.includes(`'${filter}'`)) {
      btn.classList.add("active"); 
    } else {
      btn.classList.remove("active"); 
    }
  });

  container.innerHTML = "<p>Cargando archivos...</p>";
  
  try {
    let library = await getAllLibraryItems();
    let filteredItems = filter !== 'todos' ? library.filter(item => item.type === filter) : library;

    container.innerHTML = "";

    if (filteredItems.length === 0) {
      container.innerHTML = `<p>La carpeta '${filter}' está vacía.</p>`;
    } else {
      filteredItems.forEach((item) => {
        const div = document.createElement("div");
        div.className = "library-item card"; 
        div.style.marginBottom = "10px";

        if (item.type === 'ultrastar_txt') {
          const previewTexto = item.textoPlano ? item.textoPlano.substring(0, 120) + "..." : "Sin contenido";
          div.innerHTML = `
            <p><strong>${item.name}</strong></p>
            <small>Tipo: 📝 TEXTO ULTRASTAR | ${item.date}</small>
            <div style="background: var(--bg-main); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; margin: 10px 0; white-space: pre-wrap; border: 1px solid var(--border); color: var(--text-muted);">
              ${previewTexto}
            </div>
            <div style="display: flex; gap: 10px;">
              <button type="button" data-id="${item.id}" class="load-monitor-btn" style="background:#3b82f6; color:white;">📥 Cargar en Monitor</button>
              <button type="button" data-id="${item.id}" class="delete-library-btn" style="background:#e11d48;">🗑️ Eliminar</button>
            </div>
          `;
        } else {
          const audioURL = item.audioBlob ? URL.createObjectURL(item.audioBlob) : "";
          div.innerHTML = `
            <p><strong>${item.name}</strong></p>
            <small>Tipo: ${item.type.toUpperCase()} | ${item.date}</small>
            ${audioURL ? `<audio controls src="${audioURL}" style="width:100%; margin: 10px 0;"></audio>` : '<p style="color:red; font-size:12px;">Audio no encontrado</p>'}
            <button type="button" data-id="${item.id}" class="delete-library-btn" style="background:#e11d48;">🗑️ Eliminar</button>
          `;
        }
        container.appendChild(div);
      });
    }
    
    document.querySelectorAll(".delete-library-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        await deleteLibraryItemFromDB(id);
        renderLibrary(filter); 
      });
    });

    document.querySelectorAll(".load-monitor-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const item = library.find(i => i.id === id);
        
        if (item && item.textoPlano) {
          const monitor = document.getElementById("lyricsText") || document.getElementById("miniMonitorTextArea");
          
          if (monitor) {
            monitor.value = item.textoPlano;
            
            if (item.transcription) {
              try {
                const estudioModulo = await import('./estudio.js');
                if (typeof estudioModulo.setTranscriptionSegments === 'function') {
                  estudioModulo.setTranscriptionSegments(item.transcription);
                }
              } catch (e) {
                console.warn("Módulo de estudio no listo para recibir segmentos asíncronos todavía.");
              }
              
              if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();
              if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(item.transcription);
            }

            alert(`✅ Letra de "${item.name}" cargada en el monitor del Estudio.`);
            monitor.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            alert("⚠️ No se encontró el contenedor visual del monitor en esta pantalla.");
          }
        }
      });
    });

    if (typeof loadVoiceOptionsInStudio === "function") await loadVoiceOptionsInStudio();
    if (typeof loadTrackOptionsInStudio === "function") await loadTrackOptionsInStudio();
    if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
  
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>❌ Error al cargar la biblioteca.</p>";
  }
}
export async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert("⚠️ Por favor, selecciona un archivo primero.");
    return;
  }

  const file = fileInput.files[0];
  const selectedType = typeSelect ? typeSelect.value : "pista";
  const customName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : file.name.replace(/\.[^.]+$/, "");

  try {
    if (selectedType === "ultrastar_txt") {
      const textoPlano = await file.text();
      
      await addLibraryItem({
        name: customName,
        type: selectedType,
        audioBlob: null, 
        textoPlano: textoPlano, 
        date: new Date().toLocaleString("es-ES"),
        transcription: []
      });
    } else {
      await addLibraryItem({
        name: customName,
        type: selectedType,
        audioBlob: file, 
        date: new Date().toLocaleString("es-ES"),
        transcription: []
      });
    }

    fileInput.value = "";
    if (nameInput) nameInput.value = "";
    
    await renderLibrary(selectedType);
    alert(`✅ ¡"${customName}" guardado en la biblioteca con éxito!`);

  } catch (error) {
    console.error("Error al guardar archivo manualmente:", error);
    alert("❌ Ocurrió un error al procesar y guardar tu archivo.");
  }
}
