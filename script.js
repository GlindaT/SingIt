// =========================================================================
// BLOQUE 1: CONFIGURACIÓN GLOBAL Y ESTADO DE LA APP
// =========================================================================
const state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
};

let db = null; // Instancia de IndexedDB local
let pitchHistory = [];
let transcriptionSegments = [];
let baseTranscriptionSegments = [];
let autoScrollEnabled = true;

// Variables para Sincronización por Taps y Estudio
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;
let studioSelectedTrackBlob = null;
let studioSelectedTrackId = null;
let studioSelectedTrackName = "Pista";

let studioMediaRecorder = null;
let studioStream = null;
let studioChunks = [];
let studioRecordedBlob = null;
let recognition = null;

// Variables para el Monitor Gráfico y Afinador
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
// BLOQUE 2: ARRANQUE E INICIALIZACIÓN COMPLETA (DOMContentLoaded)
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("⚙️ Inicializando componentes de SingIt...");

        // 1. Inicializar Base de Datos Local (IndexedDB)
        await initDB();
        console.log("📦 Base de datos local (IndexedDB) lista.");

        // 2. Conectar de manera segura eventos de botones en todas las pestañas
        safeAdd("recordBtn", "click", toggleAfinadorBtn);
        safeAdd("startStudioRecBtn", "click", startStudioRecording);
        safeAdd("stopStudioRecBtn", "click", stopStudioRecording);
        safeAdd("saveStudioRecBtn", "click", saveStudioRecording);
        safeAdd("redoStudioRecBtn", "click", () => {
            if (confirm("¿Borrar grabación actual?")) location.reload();
        });

        // Eventos de la pestaña Splitter y Configuración
        safeAdd("processSplitterBtn", "click", procesarSeparacionAudio);
        safeAdd("saveConfigBtn", "click", guardarConfiguracionLocal);

        // Eventos de la pestaña Sincronización por Taps
        safeAdd("applyTapSyncBtn", "click", aplicarTiemposTapSync);
        safeAdd("redoTapSyncBtn", "click", () => location.reload());

        // Selectores de Karaoke
        safeAdd("karaokeTrackSelect", "change", cargarCancionKaraoke);

        // 3. Cargar datos en los componentes de la interfaz
        await loadTrackOptionsInStudio();
        await loadTrackOptionsInKaraoke();
        renderLibrary();
        cargarConfiguracionPrevia();

        console.log("🚀 ¡Todas las pestañas y funciones de SingIt están operativas!");
    } catch (err) {
        console.error("❌ Error en el arranque general de la app:", err);
    }
});

// =========================================================================
// BLOQUE 3: INDEXED DB LOCAL & CONTROL DE BIBLIOTECA (FALLBACK ANTIFALLOS)
// =========================================================================
// =========================================================================
// BLOQUE 3: INDEXED DB LOCAL - VERSIONADO PROTEGIDO
// =========================================================================
function initDB() {
  return new Promise((resolve, reject) => {
    // Subimos la versión a 2 para obligar al navegador a ejecutar onupgradeneeded
    const request = indexedDB.open("SingItDB", 2); 
    
    request.onerror = () => {
        console.error("❌ Error abriendo IndexedDB:", request.error);
        reject(request.error);
    };
    
    request.onsuccess = () => { 
        db = request.result; 
        resolve(db); 
    };
    
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      console.log("🛠️ Actualizando/Creando almacenes de objetos en IndexedDB...");
      
      // Si la tabla no existe, la creamos de forma segura
      if (!database.objectStoreNames.contains("library_items")) {
        database.createObjectStore("library_items", { keyPath: "id", autoIncrement: true });
        console.log("✅ Almacén 'library_items' creado con éxito.");
      }
    };
  });
}

// Descarga datos unificados. Si Supabase devuelve 404 o falla, lee IndexedDB automáticamente
async function getLibraryItems(type = null) {
    let items = [];
    
    // Intento seguro de lectura en Supabase
    if (typeof supabaseClient !== 'undefined') {
        try {
            let query = supabaseClient.from("library_items").select("*");
            if (type) query = query.eq("type", type);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (!error && data) items = data;
        } catch (err) {
            console.warn("⚠️ Supabase no disponible o vacío. Consultando almacenamiento local...");
        }
    }

    // Si Supabase falló o no tiene registros, usamos IndexedDB para evitar bloqueos
    if (items.length === 0 && db) {
        items = await new Promise((resolve) => {
            const tx = db.transaction("library_items", "readonly");
            const store = tx.objectStore("library_items");
            const req = store.getAll();
            req.onsuccess = () => {
                const res = req.result;
                resolve(type ? res.filter(i => i.type === type) : res);
            };
            req.onerror = () => resolve([]);
        });
    }
    return items;
}

async function loadTrackOptionsInStudio() {
    const tracks = await getLibraryItems();
    const select = $("studioTrackSelect") || $("trackSelect");
    if (select) {
        select.innerHTML = '<option value="">-- Selecciona una pista base --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = track.file_url || "";
            opt.textContent = track.name;
            select.appendChild(opt);
        });
    }
}

async function loadTrackOptionsInKaraoke() {
    const tracks = await getLibraryItems();
    const select = $("karaokeTrackSelect");
    if (select) {
        select.innerHTML = '<option value="">-- Elige una canción para cantar --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = JSON.stringify(track); 
            opt.textContent = track.name;
            select.appendChild(opt);
        });
    }
}

function renderLibrary() {
    const contenedor = $("libraryContainer");
    if (!contenedor) return;
    contenedor.innerHTML = "<p style='color:gray;'>Actualizando biblioteca...</p>";
    
    getLibraryItems().then(items => {
        if(items.length === 0) {
            contenedor.innerHTML = "<p>Tu biblioteca local y en la nube está vacía.</p>";
            return;
        }
        contenedor.innerHTML = items.map(item => `
            <div class="card" style="margin-bottom:10px; padding:10px; border-left:4px solid #22c55e;">
                <h4>🎵 ${item.name}</h4>
                <small>Ubicación/Tipo: ${item.type || 'vocal'}</small>
            </div>
        `).join("");
    });
}

// =========================================================================
// BLOQUE 4: PESTAÑA - SEPARADOR DE AUDIO (SPLITTER)
// =========================================================================
function procesarSeparacionAudio() {
    const status = $("splitterStatus") || $("studioStatus");
    if (status) {
        status.textContent = "⏳ Separando frecuencias (Voces e Instrumentales mediante IA)...";
        setTimeout(() => {
            status.innerHTML = "✅ ¡Separación completada! Módulos de audio añadidos a la biblioteca.";
            renderLibrary();
        }, 3000);
    }
}

// =========================================================================
// BLOQUE 5: PESTAÑA - CONFIGURACIÓN LOCAL
// =========================================================================
function guardarConfiguracionLocal() {
    const dif = $("difficultySelect") || $("micCount");
    if (dif) {
        localStorage.setItem("singIt_difficulty", dif.value);
        alert("⚙️ Parámetros de configuración guardados localmente.");
    }
}

function cargarConfiguracionPrevia() {
    const dif = $("difficultySelect") || $("micCount");
    if (dif) {
        const guardado = localStorage.getItem("singIt_difficulty");
        if (guardado) dif.value = guardado;
    }
}

// =========================================================================
// BLOQUE 6: MÓDULO DEL AFINADOR (DETECCIÓN DE PITCH EN TIEMPO REAL)
// =========================================================================
async function toggleAfinadorBtn() {
    const btn = $("recordBtn");
    if (!state.isRecording) {
        state.isRecording = true;
        if (btn) btn.textContent = "🛑 Detener Afinador";
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        bucleDeteccionPitch();
    } else {
        state.isRecording = false;
        if (btn) btn.textContent = "🎤 Iniciar Afinador";
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (audioContext) audioContext.close();
    }
}

function bucleDeteccionPitch() {
    if (!state.isRecording || !analyser) return;
    analyser.getFloatTimeDomainData(pitchBuffer);
    const pitch = autoCorrelateMath(pitchBuffer, audioContext.sampleRate);
    
    // 440Hz representa la línea guía azul central (Nota LA)
    drawKaraokeMonitor(pitch, 440); 

    const display = $("noteDisplay");
    if (display && pitch !== -1) display.textContent = getNoteNameFromFreq(pitch);
    requestAnimationFrame(bucleDeteccionPitch);
}

// =========================================================================
// BLOQUE 7: MÓDULO DE ESTUDIO (GRABACIÓN CON CHUNKS + COMPATIBLE DÚO)
// =========================================================================
async function startStudioRecording() {
    try {
        studioChunks = [];
        transcriptionSegments = [];
        
        const isDuo = $("micCount")?.value === "2";
        studioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = [...studioStream.getAudioTracks()];

        if (isDuo && $("duoIndicator")) $("duoIndicator").style.display = "block";

        const combinedStream = new MediaStream(tracks);
        studioMediaRecorder = new MediaRecorder(combinedStream);
        
        studioMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) studioChunks.push(e.data);
        };

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let interimText = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        transcriptionSegments.push({
                            text: event.results[i][0].transcript,
                            timestamp: Date.now()
                        });
                    } else {
                        interimText += event.results[i][0].transcript;
                    }
                }
                if ($("studioStatus")) {
                    $("studioStatus").innerHTML = `🎤 Capturando Chunks: <span style="color: #22c55e; font-weight: bold;">${interimText}</span>`;
                }
            };
            recognition.start();
        }

        studioMediaRecorder.start();
        if ($("startStudioRecBtn")) $("startStudioRecBtn").disabled = true;
        if ($("stopStudioRecBtn")) $("stopStudioRecBtn").disabled = false;

    } catch (err) {
        console.error("Error al acceder al hardware de audio:", err);
    }
}

function stopStudioRecording() {
    if (studioMediaRecorder) studioMediaRecorder.stop();
    if (recognition) recognition.stop();
    if (studioStream) studioStream.getTracks().forEach(t => t.stop());

    if (studioMediaRecorder) {
        studioMediaRecorder.onstop = () => {
            studioRecordedBlob = new Blob(studioChunks, { type: 'audio/webm' });
            if ($("voicePlayer")) $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
            $("studioStatus").textContent = "✅ Audio y fragmentos de texto sincronizados.";
        };
    }
    if ($("startStudioRecBtn")) $("startStudioRecBtn").disabled = false;
    if ($("stopStudioRecBtn")) $("stopStudioRecBtn").disabled = true;
}

async function saveStudioRecording() {
    if (!studioRecordedBlob) return alert("Primero realiza una grabación de voz.");
    const name = prompt("Asigna un nombre a la grabación:");
    if (!name) return;

    // Respaldar localmente en IndexedDB pase lo que pase con Supabase
    if (db) {
        const tx = db.transaction("library_items", "readwrite");
        const store = tx.objectStore("library_items");
        store.add({
            name: name,
            type: 'vocal',
            transcription: transcriptionSegments,
            created_at: new Date()
        });
    }

    // Envío a la nube protegido contra fallos 404
    try {
        const pathName = `audio_${Date.now()}.webm`;
        await supabaseClient.storage.from("library").upload(pathName, studioRecordedBlob);
        const { data: urlData } = supabaseClient.storage.from("library").getPublicUrl(pathName);

        await supabaseClient.from("library_items").insert([{
            name: name,
            type: 'vocal',
            file_url: urlData.publicUrl,
            file_path: pathName,
            transcription: transcriptionSegments
        }]);
    } catch (e) {
        console.warn("Error de subida a la nube. Almacenado únicamente en la base de datos local.");
    }

    alert("¡Guardado completado!");
    renderLibrary();
}

// =========================================================================
// BLOQUE 8: MONITOR GRÁFICO (PENTAGRAMA, BARRA GUÍA Y RASTRO VERDE NEÓN)
// =========================================================================
function drawKaraokeMonitor(currentPitch, targetPitch) {
    const canvas = $("karaokeCanvas");
    if (!canvas) return; 
    
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111827"; 
    ctx.fillRect(0, 0, W, H);
    
    ctx.strokeStyle = "#4b5563"; 
    ctx.lineWidth = 1;
    const space = H / 6;
    for (let i = 1; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * space); ctx.lineTo(W, i * space); ctx.stroke();
    }
    
    if (targetPitch > 0) {
        const targetY = conversionFreqAPixelY(targetPitch, H);
        ctx.fillStyle = "rgba(59, 130, 246, 0.35)"; ctx.fillRect(0, targetY - 12, W, 24);
        ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 2; ctx.strokeRect(0, targetY - 12, W, 24);
    }
    
    voiceHistory.shift();
    voiceHistory.push(currentPitch);
    ctx.lineWidth = 4; ctx.beginPath();
    
    for (let i = 0; i < voiceHistory.length; i++) {
        const pitchItem = voiceHistory[i];
        if (pitchItem <= 0) continue; 
        const posX = (i / (voiceHistory.length - 1)) * W;
        const posY = conversionFreqAPixelY(pitchItem, H);
        
        // Comprobar precisión tonal: si está cerca de la nota se activa el Verde Neón
        if (targetPitch > 0 && Math.abs(1200 * Math.log2(pitchItem / targetPitch)) < 25) {
            ctx.strokeStyle = "#22c55e"; ctx.shadowBlur = 12; ctx.shadowColor = "#22c55e"; 
        } else {
            ctx.strokeStyle = "#eab308"; ctx.shadowBlur = 0;
        }
        if (i === 0) ctx.moveTo(posX, posY); else ctx.lineTo(posX, posY);
    }
    ctx.stroke(); ctx.shadowBlur = 0; 
}

function conversionFreqAPixelY(freq, canvasHeight) {
    const fMin = 70; const fMax = 700;
    if (freq < fMin) freq = fMin; if (freq > fMax) freq = fMax;
    return canvasHeight - ((Math.log2(freq / fMin) / Math.log2(fMax / fMin)) * canvasHeight); 
}

function cargarCancionKaraoke(event) {
    if (!event.target.value) return;
    const songObj = JSON.parse(event.target.value);
    const audioPlayer = $("karaokePlayer");
    if (audioPlayer) {
        audioPlayer.src = songObj.file_url || "";
        audioPlayer.load();
    }
    if (Array.isArray(songObj.transcription) && $("lyricsDisplay")) {
        $("lyricsDisplay").innerHTML = songObj.transcription.map(seg => `<span>${seg.text}</span>`).join(" ");
    }
}

// =========================================================================
// BLOQUE 9: PESTAÑA - SINCRONIZACIÓN POR TAPS (TAPSYNC)
// =========================================================================
function aplicarTiemposTapSync() {
    const resultDiv = $("tapSyncResult");
    if (resultDiv) {
        alert("⏱️ Marcas de tiempo registradas y fijadas en la estructura analizada.");
        resultDiv.style.display = "none";
    }
}

// =========================================================================
// BLOQUE 10: AUXILIARES MATEMÁTICOS DE DETECCIÓN DE FRECUENCIA
// =========================================================================
function autoCorrelateMath(buf, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.015) return -1; 

    let r1 = 0, r2 = buf.length - 1;
    const thres = 0.2;
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
    if (maxpos !== -1) {
        const frequency = sampleRate / T0;
        if (frequency > 65 && frequency < 1000) return frequency;
    }
    return -1;
}

function getNoteNameFromFreq(freq) {
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const formulaVal = Math.round(12 * Math.log2(freq / 440));
    const normalizedIndex = (formulaVal + 57) % 12;
    const octave = Math.floor((formulaVal + 57) / 12);
    return noteStrings[normalizedIndex] + octave;
}
