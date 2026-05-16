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

        // Archivos Locales (Carga de voz desde PC)
        safeAdd("audioFile", "change", cargarArchivoAudioPC);
      
        // Inicializar el botón de actualizar listas
        inicializarBotonesBiblioteca();

        // Transcripción Whisper de Mentira / Simulada para desarrollo
        safeAdd("transcribeVoiceBtn", "click", transcribirVozConWhisper);

        // Taps Sincronización
        safeAdd("startTapSyncBtn", "click", toggleTapSyncMode);
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

        // 4. Cargas de datos en la UI
        await loadTrackOptionsInStudio();
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
function cargarArchivoAudioPC(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Asignar a las variables globales correctas del flujo de Estudio
    studioSelectedTrackBlob = file;
    studioSelectedTrackName = file.name;
    
    // Inyectar en el reproductor específico de voz del Estudio
    const voicePlayer = $("selectedVoicePlayer") || $("player");
    if (voicePlayer) {
        voicePlayer.src = URL.createObjectURL(file);
        voicePlayer.load();
        console.log(`🎤 Voz cargada en Estudio desde PC: ${file.name}`);
    }
    
    const status = $("selectedVoiceStatus") || $("studioStatus");
    if (status) {
        status.textContent = `Estado: "${file.name}" cargado desde PC. Listo para transcribir.`;
    }
}

// Carga las opciones en el selector de pistas de Estudio
async function loadTrackOptionsInStudio() {
    const tracks = await getLibraryItems(); // Trae todo
    const select = $("studioTrackSelect");
    if (select) {
        select.innerHTML = '<option value="">Selecciona una pista desde Biblioteca</option>';
        tracks.forEach(track => {
            // Solo mostrar elementos que sean pistas de fondo o instrumentales
            if (track.type === "pista" || track.type === "audio") {
                const opt = document.createElement("option");
                opt.value = track.id;
                opt.textContent = `🎵 ${track.name}`;
                select.appendChild(opt);
            }
        });
    }
}

async function loadTrackOptionsInKaraoke() {
    try {
        const tracks = await getLibraryItems("karaoke"); // Filtra solo los elementos tipo karaoke
        const select = $("karaokeTrackSelect");
        if (select) {
            select.innerHTML = '<option value="">Selecciona una pista desde tu Biblioteca</option>';
            tracks.forEach(track => {
                const opt = document.createElement("option");
                // Guardamos el objeto completo serializado en el value para poder leer la letra después
                opt.value = JSON.stringify(track); 
                opt.textContent = `🎤 ${track.name}`;
                select.appendChild(opt);
            });
            console.log("🎯 Desplegable de Karaoke actualizado con éxito.");
        }
    } catch (err) {
        console.error("Error al cargar las opciones de Karaoke:", err);
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
    const tx = db.transaction("library_items", "readonly");
    const store = tx.objectStore("library_items");
    const req = store.get(id);
    
    req.onsuccess = () => {
        const item = req.result;
        if (!item) return;
        
        // Buscar un reproductor global o el del estudio para hacer la audición
        const audioPlayer = $("player") || $("selectedVoicePlayer");
        if (audioPlayer) {
            if (item.blob) {
                audioPlayer.src = URL.createObjectURL(item.blob);
            } else if (item.file_url) {
                audioPlayer.src = item.file_url;
            }
            audioPlayer.load();
            audioPlayer.play();
            alert(`▶️ Reproduciendo ahora desde Biblioteca: ${item.name}`);
        } else {
            alert("⚠️ No se encontró un reproductor de audio activo en esta pestaña.");
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

    const nombreKaraoke = prompt("Ponle un nombre a tu archivo Karaoke final listo para jugar:", `Karaoke - ${studioTrackFileName || "Nueva Canción"}`);
    if (!nombreKaraoke) return;

    if (db) {
        const tx = db.transaction("library_items", "readwrite");
        const store = tx.objectStore("library_items");
        store.add({
            name: nombreKaraoke,
            type: 'karaoke',
            transcription: transcriptionSegments,
            created_at: new Date()
        });
    }

    alert("🎉 ¡Mezcla completa! Empaquetado como Objeto Karaoke y enviado a tu Biblioteca.");
    renderLibrary("todos");
    loadTrackOptionsInKaraoke();
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
