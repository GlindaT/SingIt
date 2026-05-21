// ==========================================
// CONFIGURACIÓN GLOBAL Y ESTADO
// ==========================================
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

// Variables para sincronización por Taps
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

// Variables de Audio y Grabación (Estudio / Afinador)
let audioContext = null;
let analyser = null;
let stream = null;
let studioMediaRecorder = null;
let studioStream = null;
let studioStream2 = null;
let studioChunks = [];
let studioRecordedBlob = null;
let studioTrackFileName = "";
let currentVoiceObjectURL = null;

// Espacio global seguro para selecciones del usuario
window.selectedMicrophoneId = window.selectedMicrophoneId || null;
window.selectedVoiceId = window.selectedVoiceId || null;
window.selectedVoiceBlob = window.selectedVoiceBlob || null;
window.studioSelectedTrackBlob = window.studioSelectedTrackBlob || null;

// Reutilizar el buffer para el afinador y estabilización
const pitchBuffer = new Float32Array(2048);
let pitchSmoothingHistory = [];
const PITCH_SMOOTHING_FACTOR = 6; 

// Variables para visualización Dúo
let duoAudioContext = null;
let duoAnalyser1 = null;
let duoAnalyser2 = null;
let duoAnimationId = null;

// Funciones de utilidad sencillas
function $(id) {
  return document.getElementById(id);
}

// ==========================================
// INICIALIZADOR DE INTERFAZ (DOM)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        console.log("🚀 Base de datos SingItDB cargada con éxito.");
        
        // Carga inicial de datos visuales
        renderLibrary("todos");
        
        // Registro seguro de Listeners nativos
        if ($("saveManualFileBtn")) {
            $("saveManualFileBtn").addEventListener("click", saveManualFileToLibrary);
        }
        if ($("loadSelectedVoiceBtn")) {
            $("loadSelectedVoiceBtn").addEventListener("click", loadSelectedVoiceFromLibrary);
        }
        if ($("transcribeVoiceBtn")) {
            $("transcribeVoiceBtn").addEventListener("click", transcribeSelectedVoice);
        }
        if ($("refreshVoiceListBtn")) {
            $("refreshVoiceListBtn").addEventListener("click", loadMyVoicesInStudio);
        }

        // Manejo de menús colapsables / desplegables de la interfaz
        document.querySelectorAll('.encabezado-desplegable').forEach(encabezado => {
            encabezado.addEventListener('click', () => {
                const targetId = encabezado.getAttribute('data-target');
                const arrowId = encabezado.getAttribute('data-arrow');
                const contenido = document.getElementById(targetId);
                const flecha = document.getElementById(arrowId);
                
                if (contenido && flecha) {
                    contenido.classList.toggle('oculto');
                    flecha.classList.toggle('rotada');
                }
            });
        });
    } catch (err) {
        console.error("❌ Error durante la inicialización del ecosistema de la app:", err);
    }
});

// ==========================================
// INDEXED DB - CONTROLADOR DE ALMACENAMIENTO
// ==========================================
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("SingItDB", 1);

    request.onupgradeneeded = function (event) {
      const database = event.target.result;
      if (!database.objectStoreNames.contains("library")) {
        const store = database.createObjectStore("library", { keyPath: "id", autoIncrement: true });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = function (event) {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = function () {
      reject("❌ Error fatal al abrir IndexedDB local.");
    };
  });
}

function addLibraryItem(item) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const request = store.add(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject("❌ Error al persistir elemento en la base de datos.");
  });
}

function getAllLibraryItems() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject("❌ Error al extraer los elementos de la biblioteca.");
  });
}

function getLibraryItemsByType(type) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const index = store.index("type");
    const request = index.getAll(type);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(`❌ Error al filtrar archivos de tipo: ${type}`);
  });
}

function getLibraryItemById(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readonly");
    const store = transaction.objectStore("library");
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(`❌ Error al buscar archivo con ID: ${id}`);
  });
}

function updateLibraryItem(id, changes) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return reject("Archivo no encontrado para actualización.");
      const putReq = store.put({ ...item, ...changes });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject("Error al guardar cambios del elemento.");
    };
    getReq.onerror = () => reject("Error al buscar ID en base de datos.");
  });
}

function deleteLibraryItemFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["library"], "readwrite");
    const store = transaction.objectStore("library");
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject("❌ Error al purgar el archivo de IndexedDB.");
  });
}

// ==========================================
// RENDERIZADO DE VISTAS Y SISTEMA DE PESTAÑAS
// ==========================================
function showTab(tabId) {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
    const target = $(tabId);
    if (target) target.classList.add("active");

    document.querySelectorAll(".sidebar button").forEach(btn => btn.classList.remove("active"));
    
    const btnMap = {
        afinador: "btnAfinador",
        estudio: "btnEstudio",
        biblioteca: "btnBiblioteca",
        karaoke: "btnKaraoke",
        splitter: "btnSplitter",
        config: "btnConfig"
    };

    const activeBtn = $(btnMap[tabId]);
    if (activeBtn) activeBtn.classList.add("active");

    // Recargas automatizadas inteligentes al cambiar de pestaña
    try {
        switch (tabId) {
            case "config":
                cargarSelectorDeMicrofonos();
                break;
            case "biblioteca":
                renderLibrary("todos");
                break;
            case "estudio":
                loadTrackOptionsInStudio(); // Nombre unificado correctamente
                loadMyVoicesInStudio();
                break;
            case "karaoke":
                if (typeof loadMyKaraokeSongs === "function") loadMyKaraokeSongs();
                break;
        }
    } catch (error) {
        console.error(`Error al actualizar dinámicamente la pestaña ${tabId}:`, error);
    }
}

async function cargarSelectorDeMicrofonos() {
  const micSelect = document.getElementById("micSelect") || document.getElementById("audioSource");
  if (!micSelect) return;

  try {
    // Listamos dispositivos disponibles de forma pasiva
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter(device => device.kind === 'audioinput');

    micSelect.innerHTML = "";
    microphones.forEach((mic, index) => {
      const option = document.createElement("option");
      option.value = mic.deviceId;
      option.textContent = mic.label || `Micrófono Alternativo ${index + 1}`;
      micSelect.appendChild(option);
    });

    micSelect.addEventListener("change", (e) => {
      window.selectedMicrophoneId = e.target.value;
      console.log("🔄 Entrada de audio global asignada a:", window.selectedMicrophoneId);
    });
  } catch (err) {
    console.error("No se pudieron mapear los micrófonos de entrada:", err);
  }
}

// ==========================================
// AFINADOR DE VOZ EN TIEMPO REAL
// ==========================================
async function toggleRecording() {
  const btn = $("recordBtn");
  if (!state.isRecording) {
    state.isRecording = true;
    btn.textContent = "Detener";
    btn.classList.add("recording");
    await startAfinador();
  } else {
    state.isRecording = false;
    btn.textContent = "Iniciar";
    btn.classList.remove("recording");
    stopAfinador();

    if ($("noteDisplay")) $("noteDisplay").textContent = "--";
    if ($("guideText")) $("guideText").textContent = "";
  }
}

async function startAfinador() {
  audioContext = new AudioContext();
  const constraints = {
    audio: {
      deviceId: window.selectedMicrophoneId ? { exact: window.selectedMicrophoneId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      latency: { ideal: 0.005 }
    }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const mic = audioContext.createMediaStreamSource(stream);
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    mic.connect(analyser);
    
    pitchSmoothingHistory = [];
    setTimeout(() => { detectPitch(); }, 300);
  } catch (error) {
    console.error("Error capturando entrada del micrófono para el Afinador:", error);
    alert("❌ Error de acceso al micrófono. Por favor aprueba los permisos en tu navegador.");
    state.isRecording = false;
    if ($("recordBtn")) {
      $("recordBtn").textContent = "Iniciar";
      $("recordBtn").classList.remove("recording");
    }
  }
}

function stopAfinador() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioContext && audioContext.state !== "closed") audioContext.close();
}

function detectPitch() {
  if (!state.isRecording || !analyser) return;

  analyser.getFloatTimeDomainData(pitchBuffer);
  let rawPitch = autoCorrelate(pitchBuffer, audioContext.sampleRate);
  
  let pitch = -1;
  if (rawPitch !== -1 && rawPitch >= 50 && rawPitch <= 1200) {
    pitchSmoothingHistory.push(rawPitch);
    if (pitchSmoothingHistory.length > PITCH_SMOOTHING_FACTOR) {
      pitchSmoothingHistory.shift();
    }
    const suma = pitchSmoothingHistory.reduce((a, b) => a + b, 0);
    pitch = suma / pitchSmoothingHistory.length;
  } else {
    pitchSmoothingHistory.shift();
  }

  if (document.getElementById("karaokeCanvas") && typeof drawKaraokeMonitor === 'function') {
    drawKaraokeMonitor(0, pitch);
  }

  const display = $("noteDisplay");
  const guide = $("guideText");
  const targetNote = $("targetNote") ? $("targetNote").value : "E2";

  if (display && guide) {
    if (pitch !== -1 && pitchSmoothingHistory.length >= 2) {
      const noteFull = getNoteFromFrequency(pitch);
      const targetFreq = getNoteFrequency(targetNote);
      const cents = 1200 * Math.log2(pitch / targetFreq);
      
      display.textContent = noteFull;
      const dificultad = $("difficultyLevel") ? $("difficultyLevel").value : (localStorage.getItem("singIt_difficulty") || "medio");
      
      let maxDesviation = 30;
      if (dificultad === "facil") maxDesviation = 50;
      else if (dificultad === "dificil") maxDesviation = 15;
      else if (dificultad === "experto") maxDesviation = 5;
        
      if (Math.abs(cents) <= maxDesviation) {
        display.style.color = "#22c55e";
        guide.textContent = `🎯 ¡En la nota! (${targetNote})`;
        guide.style.color = "#22c55e";
      } else if (cents < 0) {
        display.style.color = "#f59e0b";
        guide.textContent = `⬆️ Estás un poco grave. Sube a ${targetNote}`;
        guide.style.color = "#f59e0b";
      } else {
        display.style.color = "#f59e0b";
        guide.textContent = `⬇️ Estás un poco agudo. Baja a ${targetNote}`;
        guide.style.color = "#f59e0b";
      }
    } else {
      display.textContent = "--";
      display.style.color = "white";
      guide.textContent = "🎤 Esperando tu voz...";
      guide.style.color = "var(--text-muted)";
    }
  }
  requestAnimationFrame(detectPitch);
}

function getNoteFromFrequency(freq) {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const A4 = 440;
  const n = Math.round(12 * Math.log2(freq / A4));
  const index = (n + 9) % 12;
  const octave = 4 + Math.floor((n + 9) / 12);
  return notes[(index + 12) % 12] + octave;
}

function getNoteFrequency(note) {
  const notes = { "C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2 };
  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return 440;
  const [, noteName, octaveStr] = match;
  return 440 * Math.pow(2, (notes[noteName] + (parseInt(octaveStr, 10) - 4) * 12) / 12);
}

function autoCorrelate(buf, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return -1;

  let bestOffset = -1;
  let bestCorrelation = 0;

  for (let offset = 8; offset < 1000; offset++) {
    let correlation = 0;
    for (let i = 0; i < buf.length - offset; i++) {
      correlation += Math.abs(buf[i] - buf[i + offset]);
    }
    correlation = 1 - (correlation / (buf.length - offset));
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation < 0.85 || bestOffset === -1) return -1;
  const frequency = sampleRate / bestOffset;
  return (frequency < 60 || frequency > 1200) ? -1 : frequency;
}

// ==========================================
// MÓDULO ESTUDIO DE GRABACIÓN
// ==========================================
function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;

  studioTrackFileName = file.name;
  $("player").src = URL.createObjectURL(file);
  $("studioStatus").textContent = `Estado: pista externa cargada (${file.name})`;
}

function playTrack() {
  if (!$("player") || !$("player").src) {
    alert("⚠️ Por favor carga una pista primero.");
    return;
  }
  $("player").play();
}

function pauseTrack() {
  if ($("player")) $("player").pause();
}

function stopTrack() {
  if (!$("player")) return;
  $("player").pause();
  $("player").currentTime = 0;
  
  // Sincronizar de forma segura con el reproductor activo del ecosistema
  if (typeof updateKaraokeHighlight === "function") updateKaraokeHighlight(0);
}

// Auxiliar dinámico de IDs para Dúo
function getSelectedMicId(micNumber) {
  const el = $(`mic${micNumber}Select`);
  return el ? el.value : null;
}

async function startStudioRecording() {
  try {
    const isDuo = $("micCount") && $("micCount").value === "2";
    studioChunks = [];
    studioRecordedBlob = null;
    $("voicePlayer").src = "";

    const mic1Id = getSelectedMicId(1);
    const mic2Id = getSelectedMicId(2);

    const constraints1 = {
      audio: {
        deviceId: mic1Id ? { exact: mic1Id } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 1, sampleRate: 48000
      }
    };

    studioStream = await navigator.mediaDevices.getUserMedia(constraints1);
    let finalStream = studioStream;

    if (isDuo && mic2Id) {
      const constraints2 = {
        audio: {
          deviceId: { exact: mic2Id },
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          channelCount: 1, sampleRate: 48000
        }
      };
      studioStream2 = await navigator.mediaDevices.getUserMedia(constraints2);
      
      duoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source1 = duoAudioContext.createMediaStreamSource(studioStream);
      const source2 = duoAudioContext.createMediaStreamSource(studioStream2);
      
      duoAnalyser1 = duoAudioContext.createAnalyser();
      duoAnalyser2 = duoAudioContext.createAnalyser();
      duoAnalyser1.fftSize = 256;
      duoAnalyser2.fftSize = 256;
      
      const merger = duoAudioContext.createChannelMerger(2);
      const destination = duoAudioContext.createMediaStreamDestination();
      
      source1.connect(duoAnalyser1);
      source2.connect(duoAnalyser2);
      duoAnalyser1.connect(merger, 0, 0);
      duoAnalyser2.connect(merger, 0, 1);
      merger.connect(destination);
      
      finalStream = destination.stream;
      if ($("duoIndicator")) $("duoIndicator").style.display = "block";
      startDuoLevelMonitor();
    }

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    studioMediaRecorder = new MediaRecorder(finalStream, options);

    studioMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) studioChunks.push(e.data);
    };

    studioMediaRecorder.onstop = () => {
      studioRecordedBlob = new Blob(studioChunks, { type: "audio/webm" });
      $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
      $("studioStatus").textContent = "Estado: Grabación de voz consolidada y lista.";
      if ($("duoIndicator")) $("duoIndicator").style.display = "none";
      stopDuoLevelMonitor();
    };

    studioMediaRecorder.start();
    
    const mic1Name = $("mic1Select") ? $("mic1Select").options[$("mic1Select").selectedIndex]?.text : "Principal";
    if (isDuo && mic2Id) {
      const mic2Name = $("mic2Select") ? $("mic2Select").options[$("mic2Select").selectedIndex]?.text : "Secundario";
      $("studioStatus").textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name})...`;
    } else {
      $("studioStatus").textContent = `Estado: 🔴 Grabando con ${mic1Name}...`;
    }

    if ($("player") && $("player").src) {
      $("player").currentTime = 0;
      $("player").play();
    }
  } catch (error) {
    console.error("Fallo crítico iniciando grabación de estudio:", error);
    $("studioStatus").textContent = "Estado: Error en la captura.";
    alert("❌ No se pudo abrir la toma de audio. Valida la configuración de hardware.");
  }
}

function startDuoLevelMonitor() {
  const level1 = $("duoMic1Level");
  const level2 = $("duoMic2Level");

  function updateLevels() {
    if (duoAnalyser1 && level1) {
      const data1 = new Uint8Array(duoAnalyser1.frequencyBinCount);
      duoAnalyser1.getByteFrequencyData(data1);
      const avg1 = data1.reduce((a, b) => a + b, 0) / data1.length;
      level1.style.width = Math.min(100, (avg1 / 128) * 100) + "%";
    }
    if (duoAnalyser2 && level2) {
      const data2 = new Uint8Array(duoAnalyser2.frequencyBinCount);
      duoAnalyser2.getByteFrequencyData(data2);
      const avg2 = data2.reduce((a, b) => a + b, 0) / data2.length;
      level2.style.width = Math.min(100, (avg2 / 128) * 100) + "%";
    }
    if (studioMediaRecorder && studioMediaRecorder.state === "recording") {
      duoAnimationId = requestAnimationFrame(updateLevels);
    }
  }
  updateLevels();
}

function stopDuoLevelMonitor() {
  if (duoAnimationId) {
    cancelAnimationFrame(duoAnimationId);
    duoAnimationId = null;
  }
  if ($("duoMic1Level")) $("duoMic1Level").style.width = "0%";
  if ($("duoMic2Level")) $("duoMic2Level").style.width = "0%";
}

function stopStudioRecording() {
  if (studioMediaRecorder && studioMediaRecorder.state !== "inactive") studioMediaRecorder.stop();
  if (studioStream) studioStream.getTracks().forEach(t => t.stop());
  if (studioStream2) {
    studioStream2.getTracks().forEach(t => t.stop());
    studioStream2 = null;
  }
  if (duoAudioContext) {
    duoAudioContext.close();
    duoAudioContext = null;
  }
  duoAnalyser1 = null;
  duoAnalyser2 = null;
  stopDuoLevelMonitor();
  if ($("duoIndicator")) $("duoIndicator").style.display = "none";
  if ($("player")) $("player").pause();
}

function redoStudioRecording() {
  studioChunks = [];
  studioRecordedBlob = null;
  $("voicePlayer").src = "";
  $("studioStatus").textContent = "Estado: Grabación descartada. Listo de nuevo.";
}

function saveStudioRecording() {
  if (!studioRecordedBlob) {
    alert("⚠️ No hay ninguna interpretación capturada para guardar.");
    return;
  }
  const baseName = studioTrackFileName ? `Voz - ${studioTrackFileName}` : "Grabación de voz independiente";
  saveToLibrary(studioRecordedBlob, { name: baseName, type: "voz" });
  $("studioStatus").textContent = "Estado: Guardado en tu biblioteca.";
}

// ==========================================
// VISTA GESTOR DE BIBLIOTECA LOCAL
// ==========================================
async function saveToLibrary(blob, options = {}) {
  try {
    await addLibraryItem({
      name: options.name || "Archivo de audio sin nombre",
      type: options.type || "audio",
      audioBlob: blob,
      date: new Date().toLocaleString("es-ES"),
      transcription: options.transcription || []
    });
    await renderLibrary("todos");
  } catch (error) {
    console.error(error);
    alert("❌ Error de almacenamiento de datos.");
  }
}

async function renderLibrary(filterType = 'todos') {
  const container = document.getElementById("libraryList");
  if (!container) return;

  try {
    container.innerHTML = "<p>Leyendo base de datos local...</p>";
    const allItems = await getAllLibraryItems();
    const filtered = allItems.filter(item => filterType === 'todos' ? true : item.type === filterType);

    if (filtered.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted);">No hay recursos guardados en la categoría (${filterType}).</p>`;
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    filtered.forEach(item => {
      const icono = item.type === 'pista' ? '🎵' : '🎤';
      const badgeColor = item.type === 'pista' ? '#22c55e' : '#a855f7';
      
      html += `
        <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 0; background: rgba(255,255,255,0.03); border: 1px solid var(--border);">
          <div>
            <span style="font-size: 18px; margin-right: 8px;">${icono}</span>
            <strong style="color: var(--text-main);">${item.name}</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              <span style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-right: 8px; text-transform: uppercase;">${item.type}</span>
              📅 ${item.date || 'Sin fecha'}
            </div>
          </div>
          <button type="button" class="btn-delete-item" data-id="${item.id}" style="background: var(--danger); color: white; padding: 6px 12px; font-size: 13px; border-radius: 6px; border: none; cursor: pointer;">🗑️ Eliminar</button>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;

    // Listeners reactivos de borrado físico
    container.querySelectorAll(".btn-delete-item").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Estás seguro de que deseas eliminar este archivo permanentemente de la base de datos local?")) {
          await deleteLibraryItemFromDB(Number(btn.dataset.id));
          await renderLibrary(filterType);
          
          // Refrescar selectores de Estudio de manera unificada
          loadTrackOptionsInStudio();
          loadMyVoicesInStudio();
        }
      });
    });

    // Sincronización en cascada con selectores de pestañas
    loadTrackOptionsInStudio();
    loadMyVoicesInStudio();

  } catch (error) {
    console.error("Fallo renderizando lista visual de biblioteca:", error);
    container.innerHTML = `<p style="color: var(--danger);">❌ Error al cargar los elementos de la biblioteca.</p>`;
  }
}

async function saveManualFileToLibrary() {
    const fileInput = $("libraryFileInput");
    const typeSelect = $("libraryFileType");
    const nameInput = $("libraryFileName");
    const file = fileInput ? fileInput.files[0] : null;
    const type = typeSelect ? typeSelect.value : "pista";
    const customName = nameInput ? nameInput.value.trim() : "";

    if (!file) {
      alert("⚠️ Por favor, selecciona un archivo de audio primero.");
      return;
    }
    const finalName = customName || file.name;

    try {
      await addLibraryItem({
        name: finalName,
        type: type,
        audioBlob: file,
        date: new Date().toLocaleString("es-ES"),
        transcription: []
      });

      if (fileInput) fileInput.value = "";
      if (nameInput) nameInput.value = "";
      if (typeSelect) typeSelect.value = "pista";

      alert("✅ ¡Archivo guardado exitosamente de forma local!");
      await renderLibrary(type);
    } catch (error) {
      console.error(error);
      alert("❌ No se pudo registrar el archivo manual.");
    }
}

// ==========================================
// CARGADORES DE COMPONENTES DEL ESTUDIO
// ==========================================
async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  try {
    const tracks = await getLibraryItemsByType("pista");
    if (!tracks.length) {
      select.innerHTML += `<option value="" disabled>No hay pistas en la biblioteca</option>`;
      return;
    }
    tracks.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date || "sin fecha"})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Fallo inyectando pistas en estudio:", error);
  }
}

async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect");
  const player = $("player");
  const status = $("studioStatus");
  if (!select || !player || !status) return;

  const selectedId = Number(select.value);
  if (!selectedId) {
    alert("⚠️ Elige una pista válida");
    return;
  }

  try {
    const item = await getLibraryItemById(selectedId);
    if (!item) {
      alert("⚠️ Pista no encontrada.");
      return;
    }
    studioTrackFileName = item.name;
    window.studioSelectedTrackBlob = item.audioBlob;
    player.src = URL.createObjectURL(item.audioBlob);
    status.textContent = `Estado: Pista cargada desde la biblioteca (${item.name})`;
  } catch (error) {
    console.error(error);
    alert("❌ Error leyendo la pista.");
  }
}

async function loadMyVoicesInStudio() {
  const select = document.getElementById("voiceLibrarySelect");
  if (!select) return;

  try {
    const allItems = await getAllLibraryItems();
    const voices = allItems.filter(item => item.type === "voz");
    select.innerHTML = '<option value="">Selecciona una voz guardada</option>';
    
    if (voices.length === 0) {
      select.innerHTML += '<option value="" disabled>No hay voces en la biblioteca</option>';
      return;
    }
    voices.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = `${voice.name} (${voice.date || 'Sin fecha'})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("Error al cargar voces en Estudio:", error);
  }
}

async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect");
  const player = $("selectedVoicePlayer");
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");
  if (!select || !player || !status) return;

  const selectedId = Number(select.value);
  if (!selectedId) {
    alert("⚠️ Selecciona una voz primero");
    return;
  }

  try {
    const item = await getLibraryItemById(selectedId);
    if (!item) {
      alert("⚠️ Audio de voz no hallado.");
      return;
    }
    window.selectedVoiceBlob = item.audioBlob;
    window.selectedVoiceId = item.id;

    // Liberación inteligente de RAM de antiguos objetos URL
    if (currentVoiceObjectURL) URL.revokeObjectURL(currentVoiceObjectURL);
    currentVoiceObjectURL = URL.createObjectURL(item.audioBlob);
    player.src = currentVoiceObjectURL;
    status.textContent = `Estado: voz seleccionada -> ${item.name}`;

    // Despliegue de letras y transcripciones guardadas
    if (Array.isArray(item.transcription) && item.transcription.length > 0) {
      baseTranscriptionSegments = item.transcription.map(seg => 
        typeof buildWordTimingFromSegment === "function" ? buildWordTimingFromSegment(seg) : seg
      );
      transcriptionSegments = baseTranscriptionSegments;
      
      if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
      if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();
      
      if (lyricsText) {
        lyricsText.value = transcriptionSegments.map(seg => seg.text || "").join("\n").trim();
      }
      status.textContent = `Estado: Voz [${item.name}] (Letras cargadas de memoria ⚡)`;
    } else {
      baseTranscriptionSegments = [];
      transcriptionSegments = [];
      if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics([]);
      if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();
      if (lyricsText) lyricsText.value = "";
      status.textContent = `Estado: voz seleccionada -> ${item.name} (sin letras guardadas en IndexedDB)`;
    }
  } catch (error) {
    console.error("Error cargando recurso de voz:", error);
    alert("❌ Error al montar la voz.");
  }
}

// ==========================================
// TRANSCRIPCIÓN CON RECONOCIMIENTO WHISPER
// ==========================================
async function transcribeSelectedVoice() {
  if (!window.selectedVoiceBlob) {
    alert("⚠️ Primero selecciona y carga una voz desde Biblioteca");
    return;
  }
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  try {
    if (status) status.textContent = "Estado: Cortando audio en porciones óptimas (Chunking)...";
    
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await window.selectedVoiceBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const CHUNK_SECONDS = 25;
    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const samplesPerChunk = CHUNK_SECONDS * sampleRate;
    let fullSegments = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      const chunkNumber = Math.floor(start / samplesPerChunk) + 1;
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);
      
      if (status) status.textContent = `Estado: Transcribiendo bloque ${chunkNumber} de ${totalChunks} en la API...`;
      
      const wavBlob = audioBufferToWav(audioBuffer, start, end);
      const base64Audio = await blobToBase64(wavBlob);
      
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64Audio })
      });
      
      if (!response.ok) throw new Error(`HTTP Error status: ${response.status}`);
      const result = await response.json();
      const palabrasProhibidas = ["Amara", "Subtítulos", "subtítulos", "Almorzo", "Suscribete", "comunidad"];
      const timeOffset = start / sampleRate;

      (result.segments || []).forEach((seg) => {
        const segText = (seg?.text || "").trim();
        if (!segText) return;
        const esFantasma = palabrasProhibidas.some((p) => segText.toLowerCase().includes(p.toLowerCase()));
        if (esFantasma) return;

        const segmentWithOffset = {
          start: Number(seg.start || 0) + timeOffset,
          end: Number(seg.end || 0) + timeOffset,
          text: segText
        };

        if (typeof buildWordTimingFromSegment === "function") {
          fullSegments.push(buildWordTimingFromSegment(segmentWithOffset));
        } else {
          fullSegments.push(segmentWithOffset);
        }
      });
    }

    baseTranscriptionSegments = fullSegments;
    if (typeof splitSegmentsIntoKaraokeLines === "function") {
      transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);
    } else {
      transcriptionSegments = baseTranscriptionSegments;
    }

    if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
    // Control de cierre seguro de cadena
    if (status) status.textContent = "Estado: ¡Transcripción completada con éxito! 🎉";

  } catch (error) {
    console.error("Error procesando transcripción Whisper:", error);
    if (status) status.textContent = "Estado: Error crítico en red o API.";
    alert("❌ La API de Whisper falló al transcribir.");
  }
}
