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
      putReq.onerror = () => reject("Error al guardar cambios");
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
                const karaokeModulo = await import('./karaoke.js');
                if (typeof karaokeModulo.cargarLetrasEnMonitor === 'function') {
                  karaokeModulo.cargarLetrasEnMonitor();
                }
              } catch (e) {
                console.warn("Módulo no listo para recibir segmentos:", e);
              }
            }

            alert(`✅ Letra de "${item.name}" cargada en el monitor del Estudio.`);
            monitor.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            alert("⚠️ No se encontró el contenedor visual del monitor en esta pantalla.");
          }
        }
      });
    });

    try {
      const estudioModulo = await import('./estudio.js');
      if (typeof estudioModulo.loadVoiceOptionsInStudio === "function") await estudioModulo.loadVoiceOptionsInStudio();
      if (typeof estudioModulo.loadTrackOptionsInStudio === "function") await estudioModulo.loadTrackOptionsInStudio();
      const karaokeModulo = await import('./karaoke.js');
      if (typeof karaokeModulo.loadTrackOptionsInKaraoke === "function") await karaokeModulo.loadTrackOptionsInKaraoke();
    } catch (e) { /* modules may not be loaded yet */ }
  
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>❌ Error al cargar la biblioteca.</p>";
  }
}
// ====================================================================
// 📥 SUBIDA MANUAL DE RECURSOS EXTERNOS (PC A BASE DE DATOS OFFLINE)
// ====================================================================

/**
 * Captura el archivo binario seleccionado por el usuario en el formulario del DOM,
 * lo empaqueta e inyecta de forma física y persistente dentro de IndexedDB.
 */
export async function saveManualFileToLibrary() {
  console.log("📥 [biblioteca.js] Disparando proceso de importación manual...");

  const fileInput = document.getElementById("libraryFileInput");
  const typeSelect = document.getElementById("libraryFileType");
  const nameInput = document.getElementById("libraryFileName");

  // Validación de seguridad de la existencia del archivo en el input
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert("⚠️ Por favor, selecciona primero un archivo de tu computadora (.mp3, .wav, .txt, etc.) antes de intentar guardarlo.");
    return;
  }

  // CORRECCIÓN DE FUERZA BRUTA INTERPOLADA: Extraemos el primer archivo usando .item(0) 
  // Esto previene que los filtros de texto del chat borren los corchetes tradicionales
  const fileObj = fileInput.files.item(0); 
  const categoriaSeleccionada = typeSelect ? typeSelect.value : "pista";
  
  if (!fileObj) {
    alert("⚠️ Error al leer el archivo seleccionado. Intenta cargarlo de nuevo.");
    return;
  }

  // Extraemos el nombre: si está vacío el input, usamos el nombre original del archivo físico de tu PC
  let nombreFinal = nameInput && nameInput.value.trim() ? nameInput.value.trim() : fileObj.name;
  nombreFinal = nombreFinal.replace(/\.[^.]+$/, ""); // Remueve extensiones duplicadas (.wav, .mp3)

  console.log(`⏳ [biblioteca.js] Procesando archivo binario legítimo: [${nombreFinal}] - Tipo: [${categoriaSeleccionada.toUpperCase()}]`);

  try {
    if (categoriaSeleccionada === "ultrastar_txt") {
      const textoPlanoExtraido = await fileObj.text();
      await addLibraryItem({
        name: `UltraStar - ${nombreFinal}`,
        type: "ultrastar_txt",
        audioBlob: null,
        textoPlano: textoPlanoExtraido,
        date: new Date().toLocaleString("es-ES")
      });
    } else {
      // Guardamos el objeto binario File/Blob puro de forma unificada en la transacción offline
      await addLibraryItem({
        name: nombreFinal,
        type: categoriaSeleccionada,
        audioBlob: fileObj, // Inyectamos el Blob binario puro certificado
        date: new Date().toLocaleString("es-ES"),
        metadata: {
          pesoBytes: fileObj.size,
          mimeType: fileObj.type,
          generadoPor: "Importador Manual SingIt Master"
        }
      });
    }

    console.log(`✅ [biblioteca.js] ¡Archivo [${nombreFinal}] inyectado con éxito en IndexedDB!`);
    alert(`🎉 ¡Importación completada con éxito!\n\nEl archivo "${nombreFinal}" ha sido guardado de forma permanente en tu Biblioteca offline. Ya está listo para usarse.`);

    // Limpieza de campos en el formulario de la interfaz
    if (fileInput) fileInput.value = "";
    if (nameInput) nameInput.value = "";

    // Forzamos el re-renderizado visual inmediato de la lista de carpetas
    await renderLibrary("todos");

  } catch (error) {
    console.error("❌ [biblioteca.js] Error crítico durante la subida manual de archivos a IndexedDB:", error);
    alert("❌ Hubo un error al intentar guardar el archivo en la base de datos local.");
  }
}
