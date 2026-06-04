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
import { $ } from '../script.js';
import { addLibraryItem, getAllLibraryItems } from './biblioteca.js'; // Conexiones locales del motor interno

/**
 * Función puente optimizada para guardar archivos y recargar la vista visual
 */
export async function saveToLibrary(blob, options = {}) {
  try {
    await addLibraryItem({
      name: options.name || "Archivo",
      type: options.type || "audio",
      audioBlob: blob || null, // Sincronizado unificadamente como audioBlob
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

  // ILUMINAR LA CARPETA SELECCIONADA (Cambiado el onclick inline problemático por lógica nativa)
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

    let filteredItems = library;
    if (filter !== 'todos') {
      filteredItems = library.filter(item => item.type === filter);
    }

    container.innerHTML = "";

    if (filteredItems.length === 0) {
      container.innerHTML = `<p>La carpeta '${filter}' está vacía.</p>`;
    } else {
      filteredItems.forEach((item) => {
        const div = document.createElement("div");
        div.className = "library-item card"; 
        div.style.marginBottom = "10px";

        // Tarjeta para archivos de texto UltraStar
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
        } 
        // Tarjeta para archivos binarios de audio (Pistas, Voces, Karaoke)
        else {
          // Sincronizado unificadamente a item.audioBlob para evitar errores accidentales
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
    
    // Asignación limpia de eventos de eliminación
    document.querySelectorAll(".delete-library-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (typeof deleteLibraryItemFromDB === "function") {
          await deleteLibraryItemFromDB(id);
          renderLibrary(filter); 
        }
      });
    });
    
    // CARGAR LETRAS DIRECTAMENTE EN EL MONITOR DEL ESTUDIO (Lazy Import integrado)
    document.querySelectorAll(".load-monitor-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const item = library.find(i => i.id === id);
        
        if (item && item.textoPlano) {
          const monitor = document.getElementById("lyricsText") || document.getElementById("miniMonitorTextArea");
          
          if (monitor) {
            monitor.value = item.textoPlano;
            
            if (item.transcription) {
              // Importación dinámica para inyectar de forma segura los segmentos en la pestaña de Estudio
              try {
                const estudioModulo = await import('./estudio.js');
                // Asumiendo que tu archivo modules/estudio.js exporte una función para actualizar su estado de segmentos
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

    // Validadores de ejecución segura para recargar selectores periféricos sin romper la app
    if (typeof loadVoiceOptionsInStudio === "function") await loadVoiceOptionsInStudio();
    if (typeof loadTrackOptionsInStudio === "function") await loadTrackOptionsInStudio();
    if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
  
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>❌ Error al cargar la biblioteca.</p>";
  }
}
import { $, renderLibrary, addLibraryItem } from './biblioteca.js';

export async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");

  if (!fileInput || !fileInput.files[0]) {
    alert("⚠️ Por favor, selecciona un archivo primero.");
    return;
  }

  const file = fileInput.files[0];
  const selectedType = typeSelect ? typeSelect.value : "pista";
  const customName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : file.name.replace(/\.[^.]+$/, "");

  try {
    // CASO A: Es un archivo de texto UltraStar (Letras)
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
    } 
    // CASO B: Es cualquier archivo de audio (Pistas, Voces)
    else {
      await addLibraryItem({
        name: customName,
        type: selectedType,
        audioBlob: file, // Sincronizado unificadamente como audioBlob
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
