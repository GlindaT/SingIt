// =========================================================================
// BLOQUE 1: CONFIGURACIÓN GLOBAL Y ESTADO DE LA APP
// =========================================================================
const state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
};

let db = null; 
let pitchHistory = [];
let transcriptionSegments = [];
let baseTranscriptionSegments = [];
let autoScrollEnabled = true;

// Variables de Estudio, Archivos Locales y Taps
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let studioTrackFileName = "";
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

let studioMediaRecorder = null;
let studioStream = null;
let studioChunks = [];
let studioRecordedBlob = null;
let recognition = null;

// Variables del Afinador y Audio
let voiceHistory = new Array(100).fill(-1);
const pitchBuffer = new Float32Array(2048);
let audioContext = null;
let analyser = null;
let stream = null;

function $(id) { return document.getElementById(id); }

function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

// =========================================================================
// BLOQUE 2: ARRANQUE E INICIALIZACIÓN (CONECTANDO NAVEGACIÓN Y BOTONES REALES)
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("⚙️ Sincronizando JavaScript con el HTML real...");

        // 1. Inicializar Base de Datos Local
        await initDB();
        console.log("📦 Base de datos local (IndexedDB) lista.");

        // 2. Controlador de Navegación Lateral (Tabs)
        const mapeoPestanas = [
            { botonId: "btnAfinador", seccionId: "afinador" },
            { botonId: "btnEstudio", seccionId: "estudio" },
            { botonId: "btnBiblioteca", seccionId: "biblioteca" },
            { botonId: "btnKaraoke", seccionId: "karaoke" },
            { botonId: "btnSplitter", seccionId: "splitter" },
            { botonId: "btnConfig", seccionId: "config" }
        ];

        mapeoPestanas.forEach(mapeo => {
            const botonEl = $(mapeo.botonId);
            if (botonEl) {
                botonEl.addEventListener('click', () => {
                    document.querySelectorAll('.tab').forEach(seccion => seccion.classList.remove('active'));
                    document.querySelectorAll('.sidebar button').forEach(btn => btn.classList.remove('active'));

                    const seccionObjetivo = $(mapeo.seccionId);
                    if (seccionObjetivo) {
                        seccionObjetivo.classList.add('active');
                        botonEl.classList.add('active');
                        console.log(`📂 Cambiado a pestaña: ${mapeo.seccionId}`);
                        if (mapeo.seccionId === 'karaoke' && typeof drawKaraokeMonitor === 'function') {
                            drawKaraokeMonitor(0, 0);
                        }
                    }
                });
            }
        });

        // 3. Vinculación de Eventos del HTML a Funciones del Script
        
        // Afinador
        safeAdd("recordBtn", "click", toggleAfinadorBtn);

        // --- ENLACE CRÍTICO: INPUT DE AUDIO DE LA PC (SUPABASE + LOCAL) ---
        // Buscamos el elemento "audioFile" y le asignamos la función que creamos antes
        const audioFileInput = document.getElementById("audioFile") || $("audioFile");
        if (audioFileInput) {
            audioFileInput.addEventListener("change", cargarArchivoAudioPC);
            console.log("📥 Buscador de archivos de la PC vinculado correctamente.");
        }
      
        // Inicializar el botón de actualizar listas de la biblioteca
        inicializarBotonesBiblioteca();

        // Transcripción Whisper de Mentira / Simulada para desarrollo
        safeAdd("transcribeVoiceBtn", "click", transcribirVozConWhisper);

        // Taps Sincronización
        safeAdd("applyTapSyncBtn", "click", finalizarSincronizacionTaps);
        safeAdd("redoTapSyncBtn", "click", () => location.reload());

        // Grabación en Estudio
        safeAdd("startStudioRecBtn", "click", startStudioRecording);
        safeAdd("stopStudioRecBtn", "click", stopStudioRecording);
        safeAdd("saveStudioRecBtn", "click", saveStudioRecording);
        safeAdd("redoStudioRecBtn", "click", () => {
            if (confirm("¿Borrar grabación actual?")) location.reload();
        });

        // Splitter
        safeAdd("splitBtn", "click", procesarSeparacionAudio);

        // Karaoke e Importador
        safeAdd("karaokeTrackSelect", "change", cargarCancionKaraoke);
        safeAdd("karaokeMixBtn", "click", mezclarYGuardarEnBibliotecaKaraoke);

        // 4. Cargas de datos iniciales en la UI
        await loadTrackOptionsInStudio();
        inicializarBotonesCargaEstudio();
        await loadTrackOptionsInKaraoke();
        renderLibrary("todos");

        console.log("🚀 ¡SingIt completamente operativo!");
    } catch (err) {
        console.error("❌ Error en el mapa de inicialización:", err);
    }
});

// =========================================================================
// BLOQUE 3: DATABASE (INDEXED DB DEFINIDO CORRECTAMENTE)
// =========================================================================
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("SingItDB", 2); 
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { db = request.result; resolve(db); };
    
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("library_items")) {
        database.createObjectStore("library_items", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

async function getLibraryItems(type = null) {
    let items = [];
    if (db) {
        items = await new Promise((resolve) => {
            const tx = db.transaction("library_items", "readonly");
            const store = tx.objectStore("library_items");
            const req = store.getAll();
            req.onsuccess = () => {
                const res = req.result;
                resolve(type && type !== "todos" ? res.filter(i => i.type === type) : res);
            };
            req.onerror = () => resolve([]);
        });
    }
    return items;
}

// =========================================================================
// BLOQUE 4: CARGA DE ARCHIVOS DESDE PC Y BIBLIOTECA
// =========================================================================
// Carga un archivo de voz limpia directamente desde la PC al Estudio
async function cargarArchivoAudioPC(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 1. Preguntar al usuario el tipo de audio para clasificarlo en las carpetas
    const tipo = prompt(
        `Detectamos: "${file.name}"\n\n¿Qué tipo de archivo es?\nEscribe exactamente:\n"pista" (para instrumentales)\n"voz" (para acapellas)\n"audio" (canción completa)`, 
        "audio"
    );

    const tipoNormalizado = (tipo && ["pista", "voz", "audio"].includes(tipo.toLowerCase())) ? tipo.toLowerCase() : "audio";
    const nombreLimpio = file.name.replace(/\.[^/.]+$/, "");

    // Generar la ruta interna en el bucket (Ej: "pistas/1715800000000_cancion.mp3")
    const filePath = `${tipoNormalizado}s/${Date.now()}_${file.name}`;
    let urlPublicaSupabase = "";

    // --- AQUÍ VA EL BLOQUE DE SUPABASE ---
    console.log("⏳ Subiendo archivo binario a Supabase Storage...");
    try {
        // Ejecuta la subida directa usando el cliente global 'supabase' que inicializaste arriba
        const { data, error } = await supabase.storage
            .from('library') // El nombre exacto de tu bucket
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) throw error;

        // Si la subida es exitosa, solicitamos la URL pública de internet para hacer streaming
        const { data: urlData } = supabase.storage
            .from('library')
            .getPublicUrl(filePath);
            
        urlPublicaSupabase = urlData.publicUrl;
        console.log("☁️ Archivo guardado en la nube con éxito. URL:", urlPublicaSupabase);

    } catch (err) {
        // Si falla por las políticas, la app no se cae; te avisa y sigue en local
        console.warn("⚠️ Nota: Guardando solo en Local (IndexedDB). Para subir a la nube, activa la Policy en Supabase:", err.message);
    }

    // --- 2. GUARDADO SIMULTÁNEO EN TU INDEXEDDB LOCAL ---
    if (db) {
        const tx = db.transaction("library", "readwrite"); // Tu almacén real 'library'
        const store = tx.objectStore("library");
        
        const nuevoItem = {
            name: nombreLimpio,
            type: tipoNormalizado,
            audioBlob: file, // Columna binaria mapeada en tu Application Tab
            file_url: urlPublicaSupabase, // Guardamos el enlace de Supabase si existe
            created_at: new Date()
        };

        store.add(nuevoItem);

        tx.oncomplete = async () => {
            alert(`🎉 "${nombreLimpio}" procesado con éxito.\n¡Cargado en interfaz y listo para usar!`);
            event.target.value = ""; // Resetear el input
            
            // Refrescar automáticamente todas las vistas de la app
            if (typeof renderLibrary === "function") await renderLibrary("todos");
            if (typeof loadTrackOptionsInStudio === "function") await loadTrackOptionsInStudio();
            if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
        };
    }
}
// Carga TODOS los audios tipo "voz" o "pista" disponibles para trabajar en el Estudio
async function loadTrackOptionsInStudio() {
    try {
        const items = await getLibraryItems(); // Recupera todo de IndexedDB
        
        const selectPista = $("studioTrackSelect") || document.querySelector("#estudio select");
        const selectVoz = $("studioVoiceSelect") || document.querySelector("section#estudio .card:nth-of-type(2) select");

        // Limpiar selectores con sus opciones por defecto
        if (selectPista) {
            selectPista.innerHTML = '<option value="">-- Selecciona una pista desde Biblioteca --</option>';
        }
        if (selectVoz) {
            selectVoz.innerHTML = '<option value="">-- Selecciona una voz guardada --</option>';
        }

        // Distribuir de forma estricta según el tipo registrado
        items.forEach(item => {
            const opt = document.createElement("option");
            opt.value = item.id;
            opt.textContent = `${item.name}`;

            if ((item.type === "pista" || item.type === "audio") && selectPista) {
                selectPista.appendChild(opt);
            } else if (item.type === "voz" && selectVoz) {
                selectVoz.appendChild(opt);
            }
        });

        console.log("✅ Selectores de Estudio (Pistas y Voces) mapeados correctamente.");
    } catch (err) {
        console.error("Error al poblar selectores de Estudio:", err);
    }
}

// 2. FUNCIÓN PARA LOS BOTONES "CARGAR PISTA" Y "CARGAR VOZ" EN TU INTERFAZ
function inicializarBotonesCargaEstudio() {
    // Botón para inyectar la Pista Musical seleccionada al reproductor
    const btnCargarPista = $("btnCargarPista") || document.querySelector("button[onclick*='Pista']"); 
    if (btnCargarPista) {
        btnCargarPista.addEventListener("click", async () => {
            const selectPista = $("studioTrackSelect") || document.querySelector("#estudio select");
            if (!selectPista || !selectPista.value) return alert("Por favor, selecciona una pista instrumental.");
            
            const item = await obtenerItemPorId(Number(selectPista.value));
            const playerPista = document.querySelector("#estudio .card:nth-of-type(1) audio") || $("player");
            
            if (item && playerPista) {
                playerPista.src = item.blob ? URL.createObjectURL(item.blob) : item.file_url;
                playerPista.load();
                console.log("🎵 Pista cargada con éxito en el reproductor de Estudio.");
            }
        });
    }

    // Botón para inyectar la Voz de la Biblioteca al reproductor inferior
    const btnCargarVoz = $("btnCargarVoz") || document.querySelector("button[onclick*='Voz']");
    if (btnCargarVoz) {
        btnCargarVoz.addEventListener("click", async () => {
            const selectVoz = $("studioVoiceSelect") || document.querySelector("section#estudio .card:nth-of-type(2) select");
            if (!selectVoz || !selectVoz.value) return alert("Por favor, selecciona una voz guardada.");
            
            const item = await obtenerItemPorId(Number(selectVoz.value));
            const playerVoz = document.querySelector("section#estudio .card:nth-of-type(2) audio") || $("selectedVoicePlayer") || $("voicePlayer");
            
            if (item && playerVoz) {
                playerVoz.src = item.blob ? URL.createObjectURL(item.blob) : item.file_url;
                playerVoz.load();
                console.log("🎙️ Voz cargada con éxito en el reproductor de Estudio.");
                const statusText = document.querySelector("section#estudio .card:nth-of-type(2) p") || $("studioStatus");
                if (statusText) statusText.textContent = `Estado: "${item.name}" lista en buffer.`;
            }
        });
    }
}

// Función auxiliar para extraer datos binarios directos de la base local
function obtenerItemPorId(id) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        const tx = db.transaction("library_items", "readonly");
        const store = tx.objectStore("library_items");
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function loadTrackOptionsInKaraoke() {
    try {
        const items = await getLibraryItems(); // Trae los elementos locales
        
        // Buscar el selector en la pestaña Karaoke (revisando variantes de ID comunes)
        const selectKaraoke = $("karaokeTrackSelect") || document.querySelector("#karaoke select") || document.querySelector("section#karaoke select");
        
        if (selectKaraoke) {
            selectKaraoke.innerHTML = '<option value="">-- Selecciona una canción desde tu Biblioteca --</option>';
            
            // Filtrar y mostrar los que tengan datos de letra guardados o tipo karaoke
            items.forEach(item => {
                if (item.type === "karaoke" || item.lyrics || item.type === "pista") {
                    const opt = document.createElement("option");
                    opt.value = item.id; // Guardamos solo el ID numérico para evitar errores
                    opt.textContent = `🎤 ${item.name}`;
                    selectKaraoke.appendChild(opt);
                }
            });
            console.log("🎯 Selector de Karaoke sincronizado con éxito.");
        }
    } catch (err) {
        console.error("Error al cargar las opciones en Karaoke:", err);
    }
}

// Renderiza la biblioteca con botones de reproducción reales para los Blobs
async function renderLibrary(filtro = "todos") {
    const contenedor = $("libraryList");
    if (!contenedor) return;
    
    try {
        const items = await getLibraryItems(filtro);
        if (items.length === 0) {
            contenedor.innerHTML = "<p style='color: #a3a3a3; padding: 10px; font-style: italic;'>Esta carpeta de la biblioteca está vacía.</p>";
            return;
        }
        
        contenedor.innerHTML = items.map(item => {
            return `
                <div class="card" style="margin-bottom:12px; padding:15px; border-left:4px solid #22c55e; background: #262626; border-radius:6px; display:flex; justify-content:between; align-items:center;">
                    <div>
                        <h4 style="margin: 0 0 5px 0; color: #fff;">🎵 ${item.name}</h4>
                        <small style="background: #404040; padding: 2px 6px; border-radius:4px; color: #67e8f9; font-size: 11px;">
                            ${item.type.toUpperCase()}
                        </small>
                    </div>
                    <div>
                        ${item.blob || item.file_url ? `
                            <button onclick="reproducirItemBiblioteca(${item.id})" class="btn-small" style="background:#22c55e; padding:5px 10px; font-size:12px;">
                                ▶️ Oír
                            </button>
                        ` : '<span style="color:gray; font-size:12px;">Sin audio</span>'}
                    </div>
                </div>
            `;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar biblioteca:", err);
    }
}

// Función clave: Permite reproducir los archivos almacenados en la base de datos
async function reproducirItemBiblioteca(id) {
    if (!db) return;
    
    const botonActual = document.getElementById(`btn-lib-${id}`);

    // SI EL USUARIO HACE CLIC EN EL AUDIO QUE YA ESTÁ SONANDO -> PAUSAR
    if (audioActualBiblioteca && idItemActualBiblioteca === id) {
        if (!audioActualBiblioteca.paused) {
            audioActualBiblioteca.pause();
            if (botonActual) {
                botonActual.textContent = "▶️ Oír";
                botonActual.style.background = "#22c55e";
            }
            console.log("⏸️ Audio pausado con éxito.");
            return;
        } else {
            audioActualBiblioteca.play();
            if (botonActual) {
                botonActual.textContent = "⏸️ Pausar";
                botonActual.style.background = "#e11d48";
            }
            return;
        }
    }

    // SI HABÍA OTRO AUDIO SONANDO DE FONDO -> DETENERLO ANTES DE INICIAR EL NUEVO
    if (audioActualBiblioteca) {
        audioActualBiblioteca.pause();
        // Restablecer el diseño del botón anterior si existe en pantalla
        const botonAnterior = document.getElementById(`btn-lib-${idItemActualBiblioteca}`);
        if (botonAnterior) {
            botonAnterior.textContent = "▶️ Oír";
            botonAnterior.style.background = "#22c55e";
        }
    }

    const tx = db.transaction("library_items", "readonly");
    const store = tx.objectStore("library_items");
    const req = store.get(id);
    
    req.onsuccess = () => {
        const item = req.result;
        if (!item) return;
        
        let urlAudio = "";
        if (item.blob) {
            urlAudio = URL.createObjectURL(item.blob);
        } else if (item.file_url) {
            urlAudio = item.file_url;
        }
        
        if (!urlAudio) return alert("Este archivo no contiene datos binarios de audio reproducibles.");

        // Enrutamiento inteligente según la pestaña activa o tipo
        const playerPista = document.querySelector("#estudio audio") || $("player");
        const playerVoz = document.querySelector("section#estudio .card:nth-of-type(2) audio") || $("selectedVoicePlayer");

        if (item.type === "voz" && playerVoz) {
            playerVoz.src = urlAudio;
            audioActualBiblioteca = playerVoz;
        } else if (item.type === "pista" && playerPista) {
            playerPista.src = urlAudio;
            audioActualBiblioteca = playerPista;
        } else {
            // Reproductor global por defecto
            const defaultPlayer = $("player") || playerPista || playerVoz;
            if (defaultPlayer) {
                defaultPlayer.src = urlAudio;
                audioActualBiblioteca = defaultPlayer;
            }
        }

        if (audioActualBiblioteca) {
            idItemActualBiblioteca = id;
            audioActualBiblioteca.load();
            audioActualBiblioteca.play()
                .then(() => {
                    if (botonActual) {
                        botonActual.textContent = "⏸️ Pausar";
                        botonActual.style.background = "#e11d48";
                    }
                })
                .catch(err => console.error("Error al reproducir:", err));

            // Al terminar el audio, restablecer el botón
            audioActualBiblioteca.onended = () => {
                if (botonActual) {
                    botonActual.textContent = "▶️ Oír";
                    botonActual.style.background = "#22c55e";
                }
                audioActualBiblioteca = null;
                idItemActualBiblioteca = null;
            };
        }
    };
}
// Vincular la acción del botón "Actualizar Lista" manualmente
function inicializarBotonesBiblioteca() {
    // Busca el botón por cualquiera de los IDs habituales que maneja tu app
    const refreshBtn = $("btnActualizarLista") || $("refreshLibraryBtn") || $("updateLibraryListBtn") || $("refreshListBtn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            await renderLibrary("todos");
            await loadTrackOptionsInStudio();
            await loadTrackOptionsInKaraoke();
            console.log("🔄 Biblioteca y selectores sincronizados manualmente.");
            alert("🔄 Listas de la biblioteca actualizadas con éxito.");
        });
    }
}

// =========================================================================
// BLOQUE 5: SPLITTER IA (SIMULADOR ESTABLE)
// =========================================================================
function procesarSeparacionAudio() {
    const fileInput = $("splitterFile");
    const statusBox = $("splitterStatusBox");
    const statusText = $("splitterStatusText");
    const detailText = $("splitterDetailText");

    if (!fileInput || !fileInput.files[0]) {
        alert("⚠️ Por favor, selecciona un archivo de audio de tu PC para separar.");
        return;
    }

    const file = fileInput.files[0];
    if (statusBox) statusBox.style.display = "block";
    
    if (statusText) statusText.textContent = "⏳ Separando Voz y Pista con IA...";
    if (detailText) detailText.textContent = "El algoritmo está aislando los canales armónicos del archivo original (3 segundos)...";

    setTimeout(() => {
        if (statusText) statusText.textContent = "✅ ¡Separación Completada con Éxito!";
        if (detailText) detailText.textContent = "Se crearon e indexaron: '[Instrumental]' y '[Voz Limpia]' en tu Biblioteca.";
        
        if (db) {
            const tx = db.transaction("library_items", "readwrite");
            const store = tx.objectStore("library_items");
            
            // Guardamos el archivo binario (Blob) real clonado para que se deje reproducir
            store.add({ 
                name: `[Instrumental] ${file.name.replace(/\.[^/.]+$/, "")}`, 
                type: 'pista', 
                blob: file, // Guardamos el binario real
                created_at: new Date() 
            });
            
            store.add({ 
                name: `[Voz Limpia] ${file.name.replace(/\.[^/.]+$/, "")}`, 
                type: 'voz', 
                blob: file, // Usamos el mismo como base reproducible
                created_at: new Date() 
            });
            
            tx.oncomplete = () => {
                // Actualizar todas las pantallas e inputs de la app automáticamente
                renderLibrary("todos");
                loadTrackOptionsInStudio();
                loadTrackOptionsInKaraoke();
            };
        }
    }, 3000);
}

// =========================================================================
// BLOQUE 6: AFINADOR CORE
// =========================================================================
async function toggleAfinadorBtn() {
    const btn = $("recordBtn");
    if (!state.isRecording) {
        state.isRecording = true;
        if (btn) btn.textContent = "🛑 Detener Afinador";
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            bucleDeteccionPitch();
        } catch (err) {
            console.error(err);
            state.isRecording = false;
            if (btn) btn.textContent = "Iniciar";
        }
    } else {
        state.isRecording = false;
        if (btn) btn.textContent = "Iniciar";
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (audioContext) audioContext.close();
    }
}

function bucleDeteccionPitch() {
    if (!state.isRecording || !analyser) return;
    analyser.getFloatTimeDomainData(pitchBuffer);
    const pitch = autoCorrelateMath(pitchBuffer, audioContext.sampleRate);
    
    const noteDisplay = $("noteDisplay");
    const guideText = $("guideText");
    const targetSelect = $("targetNote");
    
    if (pitch !== -1 && targetSelect) {
        const targetFrequency = getFreqFromNoteName(targetSelect.value);
        const currentNoteName = getNoteNameFromFreq(pitch);
        if (noteDisplay) noteDisplay.textContent = currentNoteName;
        
        const centsDeviation = 1200 * Math.log2(pitch / targetFrequency);
        drawKaraokeMonitor(pitch, targetFrequency);
        
        if (Math.abs(centsDeviation) < 25) {
            if (noteDisplay) noteDisplay.style.color = "#22c55e"; 
            if (guideText) { guideText.textContent = "🎯 ¡Perfecto! En la nota."; guideText.style.color = "#22c55e"; }
        } else if (centsDeviation > 0) {
            if (noteDisplay) noteDisplay.style.color = "#eab308";
            if (guideText) { guideText.textContent = `⬇️ Alto (+${Math.round(centsDeviation)} cents). Baja el tono.`; guideText.style.color = "#facc15"; }
        } else {
            if (noteDisplay) noteDisplay.style.color = "#eab308";
            if (guideText) { guideText.textContent = `⬆️ Bajo (${Math.round(centsDeviation)} cents). Sube el tono.`; guideText.style.color = "#facc15"; }
        }
    } else {
        if (noteDisplay) noteDisplay.style.color = "white";
        drawKaraokeMonitor(-1, targetSelect ? getFreqFromNoteName(targetSelect.value) : 440);
    }
    requestAnimationFrame(bucleDeteccionPitch);
}

// =========================================================================
// BLOQUE 7: WHISPER TRANSCRIPCIÓN, TAPS Y MEZCLA DE KARAOKE
// =========================================================================
function transcribirVozConWhisper() {
    const area = $("lyricsText");
    if (area) {
        area.value = "Aquí está la muestra de tu canción\nSeguimos cantando con pasión\nEl afinador sube hasta el cielo\nSingIt es mi software y mi anhelo";
        alert("📝 Whisper ha analizado tu pista de voz y ha extraído la letra. ¡Ahora puedes editarla libremente antes de sincronizar!");
    }
}

function toggleTapSyncMode() {
    const lyricsText = $("lyricsText");
    if (!lyricsText || !lyricsText.value.trim()) {
        alert("⚠️ Primero debes transcribir o pegar una letra en la caja de texto.");
        return;
    }
    
    const tapActiveBox = $("tapSyncActive");
    if (tapActiveBox) {
        tapSyncMode = !tapSyncMode;
        tapActiveBox.style.display = tapSyncMode ? "block" : "none";
        
        if (tapSyncMode) {
            tapSyncLines = lyricsText.value.split("\n").map(l => l.trim()).filter(Boolean);
            tapSyncTimestamps = [];
            tapSyncCurrentIndex = 0;
            actualizarUITaps();
        }
    }
}

// Capturar Espacio para los Taps
window.addEventListener("keydown", (e) => {
    if (tapSyncMode && e.code === "Space") {
        e.preventDefault();
        registrarTapStamp();
    }
});

safeAdd("tapBeatBtn", "click", registrarTapStamp);

function registrarTapStamp() {
    if (!tapSyncMode) return;
    const player = $("player") || $("selectedVoicePlayer");
    const tiempoActual = player ? player.currentTime : 0;

    if (tapSyncCurrentIndex < tapSyncLines.length) {
        tapSyncTimestamps.push({
            text: tapSyncLines[tapSyncCurrentIndex],
            start: tiempoActual
        });
        tapSyncCurrentIndex++;
        actualizarUITaps();
    } else {
        $("tapSyncActive").style.display = "none";
        $("tapSyncResult").style.display = "block";
    }
}

function actualizarUITaps() {
    if ($("tapCurrentLine")) $("tapCurrentLine").textContent = tapSyncLines[tapSyncCurrentIndex] || "¡Sincronización Terminada!";
    if ($("tapProgress")) $("tapProgress").textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`;
}

function finalizarSincronizacionTaps() {
    transcriptionSegments = tapSyncTimestamps.map((t, idx) => {
        const siguiente = tapSyncTimestamps[idx + 1];
        return {
            start: t.start,
            end: siguiente ? siguiente.start : t.start + 4,
            text: t.text
        };
    });
    alert("⏱️ Letra mapeada rítmicamente. Lista para empaquetarse.");
    $("tapSyncResult").style.display = "none";
    tapSyncMode = false;
}


function mezclarYGuardarEnBibliotecaKaraoke() {
  const selectorPista = $("studioTrackSelect");
  if (!selectorPista || !selectorPista.value) {
    alert("⚠️ Selecciona qué Pista Musical de fondo se va a mezclar con este modelo de letra.");
    return;
  }
  
  const nombreKaraoke = prompt("Ponle un nombre a tu archivo Karaoke final listo para jugar:", "Mi nueva pista sincronizada");
  if (nombreKaraoke && db) {
    const tx = db.transaction("library_items", "readwrite");
    const store = tx.objectStore("library_items");
    
    store.add({
      name: nombreKaraoke,
      type: "karaoke", // ESTO ES CLAVE para que aparezca en el nuevo selector
      lyrics: textoLetraGlobal, // Tu array de texto o marcas de tiempo
      created_at: new Date()
    });
    
    tx.oncomplete = async () => {
      alert("🎉 ¡Objeto Karaoke creado y guardado en la Biblioteca con éxito!");
      await loadTrackOptionsInKaraoke(); // Refresca el selector fantasma al instante
    };
  }
}

// =========================================================================
// BLOQUE 8: GRABACIÓN EN ESTUDIO (MEDIA RECORDER)
// =========================================================================
async function startStudioRecording() {
    try {
        studioChunks = [];
        studioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        studioMediaRecorder = new MediaRecorder(studioStream);
        
        studioMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) studioChunks.push(e.data); };
        studioMediaRecorder.start();

        if ($("studioStatus")) $("studioStatus").textContent = "🎙️ Grabando voz en tiempo real...";
        if ($("startStudioRecBtn")) $("startStudioRecBtn").disabled = true;
        if ($("stopStudioRecBtn")) $("stopStudioRecBtn").disabled = false;
    } catch (err) { console.error(err); }
}

function stopStudioRecording() {
    if (studioMediaRecorder) {
        studioMediaRecorder.stop();
        studioMediaRecorder.onstop = () => {
            studioRecordedBlob = new Blob(studioChunks, { type: 'audio/webm' });
            if ($("voicePlayer")) $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
            if ($("studioStatus")) $("studioStatus").textContent = "✅ Grabación en buffer temporal.";
        };
    }
    if (studioStream) studioStream.getTracks().forEach(t => t.stop());
    if ($("startStudioRecBtn")) $("startStudioRecBtn").disabled = false;
    if ($("stopStudioRecBtn")) $("stopStudioRecBtn").disabled = true;
}

function saveStudioRecording() {
    if (!studioRecordedBlob) return alert("No hay audio grabado.");
    if (db) {
        const tx = db.transaction("library_items", "readwrite");
        const store = tx.objectStore("library_items");
        store.add({ name: `Grabación_${Date.now()}`, type: 'grabacion', created_at: new Date() });
    }
    alert("Guardado local completado.");
    renderLibrary("todos");
}

// =========================================================================
// BLOQUE 9: RENDER MONITOR CANVA (PENTAGRAMA)
// =========================================================================
function drawKaraokeMonitor(currentPitch, targetPitch) {
    const canvas = $("karaokeCanvas");
    if (!canvas) return; 
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    
    ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#4b5563"; ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * (H / 6)); ctx.lineTo(W, i * (H / 6)); ctx.stroke();
    }
    if (targetPitch > 0) {
        const targetY = conversionFreqAPixelY(targetPitch, H);
        ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 2; ctx.strokeRect(0, targetY - 10, W, 20);
    }
    voiceHistory.shift(); voiceHistory.push(currentPitch);
    ctx.lineWidth = 4;
    for (let i = 0; i < voiceHistory.length; i++) {
        if (voiceHistory[i] <= 0) continue;
        const posX = (i / (voiceHistory.length - 1)) * W;
        const posY = conversionFreqAPixelY(voiceHistory[i], H);
        ctx.strokeStyle = (targetPitch > 0 && Math.abs(1200 * Math.log2(voiceHistory[i] / targetPitch)) < 25) ? "#22c55e" : "#eab308";
        ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(posX - 2, posY - 2, 4, 4);
    }
}

function conversionFreqAPixelY(freq, canvasHeight) {
    const fMin = 70, fMax = 700;
    if (freq < fMin) freq = fMin; if (freq > fMax) freq = fMax;
    return canvasHeight - ((Math.log2(freq / fMin) / Math.log2(fMax / fMin)) * canvasHeight); 
}

function cargarCancionKaraoke(event) {
    if (!event.target.value) return;
    const song = JSON.parse(event.target.value);
    if (Array.isArray(song.transcription) && $("karaokeLiveLyrics")) {
        $("karaokeLiveLyrics").style.display = "block";
        $("karaokeLiveLyrics").innerHTML = song.transcription.map(s => `<p style='font-size:18px; color:#facc15;'>🎤 ${s.text}</p>`).join("");
    }
}

// =========================================================================
// BLOQUE 10: MATEMÁTICAS MUSICALES Y AFINACIÓN
// =========================================================================
function autoCorrelateMath(buf, sampleRate) {
    let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    if (Math.sqrt(rms / buf.length) < 0.015) return -1; 
    let r1 = 0, r2 = buf.length - 1, thres = 0.2;
    for (let i = 0; i < buf.length / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = buf.length - 1; i >= buf.length / 2; i--) { if (Math.abs(buf[i]) < thres) { r2 = i; break; } }
    const bufSlice = buf.subarray(r1, r2);
    const c = new Float32Array(bufSlice.length);
    for (let i = 0; i < bufSlice.length; i++) {
        for (let j = 0; j < bufSlice.length - i; j++) c[i] += bufSlice[j] * bufSlice[j + i];
    }
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < c.length; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
    let T0 = maxpos;
    if (maxpos !== -1) { const frequency = sampleRate / T0; if (frequency > 65 && frequency < 1000) return frequency; }
    return -1;
}

function getNoteNameFromFreq(freq) {
    if (!freq || freq <= 0) return "--";
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const formulaVal = Math.round(12 * Math.log2(freq / 440));
    const normalizedIndex = (formulaVal + 57) % 12;
    const octave = Math.floor((formulaVal + 57) / 12);
    return (normalizedIndex >= 0 && normalizedIndex < 12) ? noteStrings[normalizedIndex] + octave : "--";
}

function getFreqFromNoteName(noteName) {
    if (!noteName) return 440;
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const octave = parseInt(noteName.slice(-1));
    const notePos = noteName.slice(0, -1);
    const noteIndex = notes.indexOf(notePos);
    if (noteIndex === -1) return 440;
    return 16.3516 * Math.pow(2, ((octave * 12) + noteIndex) / 12);
}
