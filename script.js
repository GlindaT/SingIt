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

function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
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
      // navegación
      safeAdd("btnAfinador", "click", () => showTab("afinador"));
      safeAdd("btnEstudio", "click", () => showTab("estudio"));
      safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
      safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
      safeAdd("btnSplitter", "click", () => showTab("splitter"));
      safeAdd("btnConfig", "click", () => showTab("config"));

      // afinador
      safeAdd("recordBtn", "click", toggleRecording);

      // estudio
      safeAdd("audioFile", "change", cargarAudioEstudio);
      safeAdd("refreshStudioTrackListBtn", "click", loadTrackOptionsInStudio);
      safeAdd("loadStudioTrackBtn", "click", loadSelectedTrackFromLibraryStudio);
      safeAdd("playTrackBtn", "click", playTrack);
      safeAdd("pauseTrackBtn", "click", pauseTrack);
      safeAdd("stopTrackBtn", "click", stopTrack);
      safeAdd("startStudioRecBtn", "click", startStudioRecording);
      safeAdd("stopStudioRecBtn", "click", stopStudioRecording);
      safeAdd("redoStudioRecBtn", "click", redoStudioRecording);
      safeAdd("saveStudioRecBtn", "click", saveStudioRecording);
      safeAdd("refreshVoiceListBtn", "click", loadVoiceOptionsInStudio);
      safeAdd("loadSelectedVoiceBtn", "click", loadSelectedVoiceFromLibrary);
      safeAdd("transcribeVoiceBtn", "click", transcribeSelectedVoice);
      safeAdd("applyCorrectedLyricsBtn", "click", applyCorrectedLyrics);

      // Toggle auto-scroll
      safeAdd("toggleAutoScrollBtn", "click", () => {
        autoScrollEnabled = !autoScrollEnabled;
        const btn = $("toggleAutoScrollBtn");
        if (btn) {
          btn.textContent = autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
          btn.style.background = autoScrollEnabled ? "#f59e0b" : "#6b7280";
        }
      });

      // Eventos de sincronización con Taps
      safeAdd("startTapSyncBtn", "click", startTapSync);
      safeAdd("cancelTapSyncBtn", "click", cancelTapSync);
      safeAdd("tapBeatBtn", "click", recordTap);
      safeAdd("applyTapSyncBtn", "click", applyTapSync);
      safeAdd("redoTapSyncBtn", "click", redoTapSync);

      // Cargar catálogo y mis canciones al iniciar
      loadKaraokeCatalog();
      loadMyKaraokeSongs();

      safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
        await loadKaraokeCatalog();
        await loadMyKaraokeSongs();
      });

      // biblioteca
      safeAdd("saveLibraryFileBtn", "click", saveManualFileToLibrary);

      // karaoke
      safeAdd("karaokeTrackFile", "change", cargarPistaKaraoke);
      safeAdd("karaokeStartBtn", "click", startKaraokeRecording);
      safeAdd("karaokeStopBtn", "click", stopKaraokeRecording);
      safeAdd("karaokeRestartBtn", "click", restartKaraokeRecording);
      safeAdd("karaokeMixBtn", "click", mixKaraoke);
      safeAdd("refreshKaraokeTrackBtn", "click", loadTrackOptionsInKaraoke);
      safeAdd("loadKaraokeTrackBtn", "click", loadSelectedTrackFromLibraryKaraoke);

      const kTrack = $("karaokeTrack");
      if (kTrack) {
        kTrack.addEventListener("timeupdate", () => {
          syncKaraokeMonitor(kTrack.currentTime);
        });
      }

      // splitter
      safeAdd("splitBtn", "click", splitAudio);

      // micrófonos
      safeAdd("refreshMicsBtn", "click", loadAvailableMics);
      safeAdd("testMic1Btn", "click", () => testMicrophone(1));
      safeAdd("testMic2Btn", "click", () => testMicrophone(2));
      safeAdd("mic1Select", "change", () => saveMicSelection(1));
      safeAdd("mic2Select", "change", () => saveMicSelection(2));
      safeAdd("micCount", "change", toggleMic2Visibility);

      // Cargar micrófonos al iniciar
      loadAvailableMics();
      toggleMic2Visibility();

      // init
      await loadTrackOptionsInStudio();
      await loadTrackOptionsInKaraoke();

      const player = $("player") || document.getElementById("player");
      if (player) {
        player.addEventListener("timeupdate", () => updateKaraokeHighlight(player.currentTime));
        player.addEventListener("ended", () => updateKaraokeHighlight(player.currentTime));
      }

      const karaokeTrack = document.getElementById("karaokeTrack") || $("karaokeTrack");
      if (karaokeTrack) {
        karaokeTrack.addEventListener("timeupdate", () => updateKaraokeHighlight(karaokeTrack.currentTime));
        karaokeTrack.addEventListener("ended", () => updateKaraokeHighlight(karaokeTrack.currentTime));
      }
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
                loadAvailableMics();
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

async function loadAvailableMics() {
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

function toggleMic2Visibility() {
  const micCount = $("micCount");
  const mic2Group = $("mic2Group");

  if (micCount && mic2Group) {
    if (micCount.value === "2") {
      mic2Group.style.display = "block";
    } else {
      mic2Group.style.display = "none";
    }
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
  const notes = {
    "C": -9,
    "C#": -8,
    "D": -7,
    "D#": -6,
    "E": -5,
    "F": -4,
    "F#": -3,
    "G": -2,
    "G#": -1,
    "A": 0,
    "A#": 1,
    "B": 2
  };

  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return 440;

  const [, noteName, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  const semitoneOffset = notes[noteName] + (octave - 4) * 12;
  return 440 * Math.pow(2, semitoneOffset / 12);
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

async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;

  try {
    const voces = await getLibraryItemsByType("voz");
    const grabaciones = await getLibraryItemsByType("grabacion");

    const merged = [...voces, ...grabaciones];

    if (!merged.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay voces guardadas";
      select.appendChild(option);
      return;
    }

    merged.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date || "sin fecha"})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
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

// ==========================================
// FUNCIONES AUXILIARES AUDIO
// ==========================================
function audioBufferToWav(buffer, startSample, endSample) {
  const length = endSample - startSample;
  const wavBuffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(wavBuffer);
  const sampleRate = buffer.sampleRate;

  const writeString = (viewObj, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      viewObj.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, length * 2, true);

  const channelData = buffer.getChannelData(0);
  let offset = 44;

  for (let i = startSample; i < endSample; i++) {
    let sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const base64String = reader.result.split(",")[1];
      resolve(base64String);
    };

    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildWordTimingFromSegment(segment) {
  const cleanText = (segment.text || "").trim();

  if (!cleanText) {
    return {
      ...segment,
      words: []
    };
  }

  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  const segmentDuration = Math.max(0, (segment.end || 0) - (segment.start || 0));

  if (!rawWords.length || segmentDuration <= 0) {
    return {
      ...segment,
      words: rawWords.map(word => ({
        word,
        start: segment.start,
        end: segment.end,
        pitch: segment.pitch || null,
        note: segment.note || null
      }))
    };
  }

  const totalChars = rawWords.reduce((sum, word) => sum + word.length, 0) || rawWords.length;
  let cursor = segment.start;

  const timedWords = rawWords.map((word, index) => {
    const weight = word.length / totalChars;
    let duration = segmentDuration * weight;

    if (index === rawWords.length - 1) {
      duration = segment.end - cursor;
    }

    const wordStart = cursor;
    const wordEnd = cursor + duration;
    cursor = wordEnd;

    return {
      word,
      start: wordStart,
      end: wordEnd,
      pitch: segment.pitch || null,
      note: segment.note || null
    };
  });

  return {
    ...segment,
    words: timedWords
  };
}

// ==========================================
// ANÁLISIS DE PITCH
// ==========================================
async function analyzePitchForSegments(audioBlob, segments) {
  if (!audioBlob || !segments || !segments.length) {
    console.log("⚠️ No hay audio o segmentos para analizar");
    return segments;
  }

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    
    console.log("🎵 Analizando pitch de", segments.length, "segmentos...");

    const analyzedSegments = segments.map((segment, index) => {
      // Obtener muestras para este segmento
      const startSample = Math.floor(segment.start * sampleRate);
      const endSample = Math.floor(segment.end * sampleRate);
      
      // Extraer porción del audio
      const segmentSamples = channelData.slice(startSample, endSample);
      
      // Detectar pitch promedio del segmento
      const pitch = detectPitchFromSamples(segmentSamples, sampleRate);
      const note = pitch > 0 ? getNoteFromFrequency(pitch) : null;
      const midiNote = pitch > 0 ? frequencyToMidi(pitch) : null;
      
      // Analizar pitch por palabra si hay palabras
      let analyzedWords = [];
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        analyzedWords = segment.words.map(word => {
          const wordStartSample = Math.floor(word.start * sampleRate);
          const wordEndSample = Math.floor(word.end * sampleRate);
          const wordSamples = channelData.slice(wordStartSample, wordEndSample);
          
          const wordPitch = detectPitchFromSamples(wordSamples, sampleRate);
          const wordNote = wordPitch > 0 ? getNoteFromFrequency(wordPitch) : note;
          const wordMidi = wordPitch > 0 ? frequencyToMidi(wordPitch) : midiNote;
          
          return {
            ...word,
            pitch: wordPitch > 0 ? wordPitch : pitch,
            note: wordNote,
            midi: wordMidi
          };
        });
      }

      return {
        ...segment,
        pitch: pitch,
        note: note,
        midi: midiNote,
        words: analyzedWords
      };
    });

    console.log("✅ Análisis de pitch completado");
    return analyzedSegments;

  } catch (error) {
    console.error("❌ Error analizando pitch:", error);
    return segments;
  }
}

function detectPitchFromSamples(samples, sampleRate) {
  if (!samples || samples.length < 256) return -1;
  
  // Calcular RMS para verificar si hay señal
  let rms = 0;
  for (let i = 0; i < samples.length; i++) {
    rms += samples[i] * samples[i];
  }
  rms = Math.sqrt(rms / samples.length);
  
  if (rms < 0.01) return -1; // Silencio
  
  // Autocorrelación simplificada
  const bufferSize = Math.min(2048, samples.length);
  const buffer = samples.slice(0, bufferSize);
  
  let bestOffset = -1;
  let bestCorrelation = 0;
  
  for (let offset = 8; offset < bufferSize / 2; offset++) {
    let correlation = 0;
    
    for (let i = 0; i < bufferSize - offset; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    
    correlation = 1 - (correlation / (bufferSize - offset));
    
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  
  if (bestCorrelation < 0.8 || bestOffset === -1) return -1;
  
  const frequency = sampleRate / bestOffset;
  
  // Filtrar frecuencias fuera del rango vocal
  if (frequency < 80 || frequency > 1000) return -1;
  
  return frequency;
}

function frequencyToMidi(freq) {
  if (freq <= 0) return 0;
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}



function splitSegmentsIntoKaraokeLines(segments, maxWordsPerLine = 6) {
  const result = [];

  segments.forEach((segment) => {
    const words = Array.isArray(segment.words) && segment.words.length
      ? segment.words
      : buildWordTimingFromSegment(segment).words;

    if (!words.length) return;

    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      const chunk = words.slice(i, i + maxWordsPerLine);
      if (!chunk.length) continue;

      result.push({
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        text: chunk.map(w => w.word).join(" "),
        words: chunk
      });
    }
  });

  return result;
}

function buildSegmentsFromMultilineLyrics(text, baseSegments) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length || !Array.isArray(baseSegments) || !baseSegments.length) {
    return [];
  }

  const totalStart = baseSegments[0].start;
  const totalEnd = baseSegments[baseSegments.length - 1].end;
  const totalDuration = Math.max(0, totalEnd - totalStart);

  if (totalDuration <= 0) return [];

  const lineWeights = lines.map(line => {
    const words = line.split(/\s+/).filter(Boolean);
    return words.reduce((sum, w) => sum + w.length, 0) || words.length || 1;
  });

  const totalWeight = lineWeights.reduce((a, b) => a + b, 0) || 1;

  let cursor = totalStart;

  return lines.map((line, index) => {
    let duration = totalDuration * (lineWeights[index] / totalWeight);

    if (index === lines.length - 1) {
      duration = totalEnd - cursor;
    }

    const segment = {
      start: cursor,
      end: cursor + duration,
      text: line
    };

    cursor += duration;
    return buildWordTimingFromSegment(segment);
  });
}

function renderKaraokeLyrics(segments) {
  const container = $("karaokeLyrics");
  if (!container) return;

  console.log("renderKaraokeLyrics -> segmentos:", segments);

  container.innerHTML = "";

  if (!Array.isArray(segments) || !segments.length) {
    container.innerHTML = `<p class="karaoke-placeholder">No hay segmentos para mostrar.</p>`;
    return;
  }

  segments.forEach((segment, index) => {
    const line = document.createElement("p");
    line.className = "karaoke-line";
    line.dataset.index = index;
    line.dataset.start = Number(segment.start || 0);
    line.dataset.end = Number(segment.end || 0);

    const words = Array.isArray(segment.words) ? segment.words : [];

    if (words.length) {
      words.forEach((wordObj, wordIndex) => {
        const span = document.createElement("span");
        span.className = "karaoke-word";
        span.dataset.start = Number(wordObj.start || 0);
        span.dataset.end = Number(wordObj.end || 0);
        span.textContent = (wordObj.word || "") + (wordIndex < words.length - 1 ? " " : "");
        line.appendChild(span);
      });
    } else {
      line.textContent = (segment.text || "").trim();
    }

    container.appendChild(line);
  });
}

function updateKaraokeHighlight(currentTime) {
  // Intentamos buscar las líneas en vivo primero, si no, las normales del juego
  let lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) {
    lines = document.querySelectorAll(".karaoke-line");
  }
  
  if (!lines.length) return;

  let activeLine = null;

  lines.forEach((line) => {
    const start = parseFloat(line.dataset.start || 0);
    const end = parseFloat(line.dataset.end || 0);

    line.classList.remove("active", "past", "upcoming");

    if (currentTime >= start && currentTime <= end) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end) {
      line.classList.add("past");
    } else {
      line.classList.add("upcoming");
    }

    // Buscamos las palabras dinámicamente según las clases que tenga la línea
    const words = line.querySelectorAll(".karaoke-live-word, .karaoke-word");
    
    words.forEach((word) => {
      const wordStart = parseFloat(word.dataset.start || 0);
      const wordEnd = parseFloat(word.dataset.end || 0);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  });

  // El scroll automático que ya tenías programado (¡perfecto!)
  if (activeLine && typeof autoScrollEnabled !== "undefined" && autoScrollEnabled) {
    activeLine.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
}

// ==========================================
// KARAOKE
// ==========================================
let karaokeMediaRecorder = null;
let karaokeStream = null;
let karaokeStream2 = null;
let karaokeChunks = [];
let karaokeRecordedBlob = null;
let karaokeSelectedTrackBlob = null;
let karaokeSelectedTrackName = "Pista";
let lastActiveLine = null;
let karaokeDuoAudioContext = null;
let karaokeDuoAnalyser1 = null;
let karaokeDuoAnalyser2 = null;
let karaokeDuoAnimationId = null;
let currentKaraokeObjectURL = null;

function cargarPistaKaraoke(e) {
  const file = e.target.files[0];
  if (!file) return;

  karaokeSelectedTrackBlob = file;
  karaokeSelectedTrackName = file.name;

  const track = $("karaokeTrack");
  track.src = URL.createObjectURL(file);
  track.volume = 0.4;

  $("karaokeStatus").textContent = "Estado: Pista lista. ¡Presiona Iniciar Grabación!";
  cargarLetrasEnMonitor();
}

async function loadTrackOptionsInKaraoke() {
  const select = $("karaokeTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde tu Biblioteca</option>`;

  try {
    const pistas = await getLibraryItemsByType("pista");

    if (!pistas.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay pistas guardadas";
      select.appendChild(option);
      return;
    }

    pistas.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

async function loadSelectedTrackFromLibraryKaraoke() {
  const select = $("karaokeTrackSelect");
  const id = Number(select.value);

  if (!id) {
    alert("⚠️ Selecciona una pista de la lista.");
    return;
  }

  try {
    const item = await getLibraryItemById(id);
    if (!item) return;

    karaokeSelectedTrackBlob = item.audioBlob;
    karaokeSelectedTrackName = item.name;

    const track = $("karaokeTrack");
    track.src = URL.createObjectURL(item.audioBlob);
    track.volume = 0.4;

    $("karaokeStatus").textContent = `Estado: Pista cargada (${item.name}). ¡Inicia grabación!`;
    cargarLetrasEnMonitor();
  } catch (error) {
    console.error(error);
    alert("❌ Error al cargar la pista.");
  }
}

function cargarLetrasEnMonitor() {
  const container = $("karaokeLiveLyrics");
  if (!container) return;

  console.log("cargarLetrasEnMonitor -> transcriptionSegments:", transcriptionSegments);

  container.innerHTML = "";

  if (!Array.isArray(transcriptionSegments) || transcriptionSegments.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size:18px;">⚠️ Ve a la pestaña 'Estudio', transcribe una voz y vuelve aquí para ver la letra.</p>`;
    return;
  }

  // Mantenemos tu flujo original de bloque horizontal para el subtítulo del juego
  transcriptionSegments.forEach((seg) => {
    const p = document.createElement("p");
    p.className = "karaoke-live-line";
    p.dataset.start = Number(seg.start || 0);
    p.dataset.end = Number(seg.end || 0);

    const words = Array.isArray(seg.words) ? seg.words : [];

    if (words.length) {
      words.forEach((wordObj, index) => {
        const span = document.createElement("span");
        span.className = "karaoke-live-word";
        span.dataset.start = Number(wordObj.start || 0);
        span.dataset.end = Number(wordObj.end || 0);
        span.textContent = (wordObj.word || "") + (index < words.length - 1 ? " " : "");
        p.appendChild(span);
      });
    } else {
      p.textContent = (seg.text || "").trim();
    }

    container.appendChild(p);
  });
}

async function startKaraokeRecording() {
  const track = $("karaokeTrack");

  if (!track || !track.src) {
    alert("⚠️ Primero sube una pista instrumental en el Paso 1.");
    return;
  }

  try {
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    karaokeChunks = [];
    karaokeRecordedBlob = null;
    $("karaokeVoicePlayer").src = "";

    // Obtener micrófonos seleccionados
    const mic1Id = getSelectedMicId(1);
    const mic2Id = getSelectedMicId(2);

    const audioConstraints1 = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000
    };

    if (mic1Id) {
      audioConstraints1.deviceId = { exact: mic1Id };
    }

    // Obtener stream del Mic 1
    karaokeStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints1
    });

    let finalStream = karaokeStream;

    // Si es DÚO, obtener y mezclar Mic 2
    if (isDuo && mic2Id) {
      const audioConstraints2 = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
        deviceId: { exact: mic2Id }
      };

      karaokeStream2 = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints2
      });

      // Crear contexto de audio para mezclar
      karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();

      const source1 = karaokeDuoAudioContext.createMediaStreamSource(karaokeStream);
      const source2 = karaokeDuoAudioContext.createMediaStreamSource(karaokeStream2);

      // Crear analizadores para visualización
      karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser2 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser1.fftSize = 256;
      karaokeDuoAnalyser2.fftSize = 256;

      // Crear mezclador
      const merger = karaokeDuoAudioContext.createChannelMerger(2);
      const destination = karaokeDuoAudioContext.createMediaStreamDestination();

      // Conectar: fuentes -> analizadores -> mezclador -> destino
      source1.connect(karaokeDuoAnalyser1);
      source2.connect(karaokeDuoAnalyser2);
      karaokeDuoAnalyser1.connect(merger, 0, 0);
      karaokeDuoAnalyser2.connect(merger, 0, 1);
      merger.connect(destination);

      finalStream = destination.stream;

      // Mostrar indicador de dúo
      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "block";
      }

      // Iniciar visualización de niveles
      startKaraokeDuoLevelMonitor();
    }

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};

    karaokeMediaRecorder = new MediaRecorder(finalStream, options);

    karaokeMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) karaokeChunks.push(e.data);
    };

    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      $("karaokeVoicePlayer").src = URL.createObjectURL(karaokeRecordedBlob);
      $("karaokeStatus").textContent = "Estado: Grabación finalizada ✅";

      // Ocultar indicador dúo
      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "none";
      }

      stopKaraokeDuoLevelMonitor();
    };

    karaokeMediaRecorder.start();
    track.currentTime = 0;
    track.play();

    // ¡AQUÍ ACTIVAMOS EL MONITOR!
    startKaraokePitchDetection();

    // Mostrar estado
    const mic1Select = $("mic1Select");
    const mic1Name = mic1Select ? mic1Select.options[mic1Select.selectedIndex]?.text : "Predeterminado";

    if (isDuo && mic2Id) {
      const mic2Select = $("mic2Select");
      const mic2Name = mic2Select ? mic2Select.options[mic2Select.selectedIndex]?.text : "Mic 2";
      $("karaokeStatus").textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name})...`;
    } else {
      $("karaokeStatus").textContent = `Estado: 🔴 Grabando con ${mic1Name}...`;
    }

    $("karaokeStartBtn").disabled = true;

  } catch (err) {
    console.error(err);
    alert("❌ Error al acceder al micrófono. Verifica en Configuración.");
  }
}

function startKaraokeDuoLevelMonitor() {
  const level1 = $("karaokeDuoMic1Level");
  const level2 = $("karaokeDuoMic2Level");

  function updateLevels() {
    if (karaokeDuoAnalyser1 && level1) {
      const data1 = new Uint8Array(karaokeDuoAnalyser1.frequencyBinCount);
      karaokeDuoAnalyser1.getByteFrequencyData(data1);
      const avg1 = data1.reduce((a, b) => a + b, 0) / data1.length;
      level1.style.width = Math.min(100, (avg1 / 128) * 100) + "%";
    }

    if (karaokeDuoAnalyser2 && level2) {
      const data2 = new Uint8Array(karaokeDuoAnalyser2.frequencyBinCount);
      karaokeDuoAnalyser2.getByteFrequencyData(data2);
      const avg2 = data2.reduce((a, b) => a + b, 0) / data2.length;
      level2.style.width = Math.min(100, (avg2 / 128) * 100) + "%";
    }

    if (karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") {
      karaokeDuoAnimationId = requestAnimationFrame(updateLevels);
    }
  }

  updateLevels();
}

function stopKaraokeDuoLevelMonitor() {
  if (karaokeDuoAnimationId) {
    cancelAnimationFrame(karaokeDuoAnimationId);
    karaokeDuoAnimationId = null;
  }

  // Resetear barras
  const level1 = $("karaokeDuoMic1Level");
  const level2 = $("karaokeDuoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

function stopKaraokeRecording() {
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    karaokeMediaRecorder.stop();
  }

  // Detener Mic 1
  if (karaokeStream) {
    karaokeStream.getTracks().forEach(t => t.stop());
  }

  // Detener Mic 2 (si existe)
  if (karaokeStream2) {
    karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeStream2 = null;
  }

  // Cerrar contexto de audio dúo
  if (karaokeDuoAudioContext) {
    karaokeDuoAudioContext.close();
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;

  stopKaraokeDuoLevelMonitor();

  // Ocultar indicador
  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) {
    duoIndicator.style.display = "none";
  }

  const track = $("karaokeTrack");
  if (track) track.pause();

  $("karaokeStartBtn").disabled = false;
}

function restartKaraokeRecording() {
  const track = $("karaokeTrack");

  if (track) {
    track.pause();
    track.currentTime = 0;
  }

  $("karaokeVoicePlayer").src = "";
  karaokeChunks = [];
  karaokeRecordedBlob = null;
  $("karaokeStatus").textContent = "Estado: Esperando para grabar...";
  $("karaokeStartBtn").disabled = false;
}

function syncKaraokeMonitor(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) return;

  let activeLine = null;

  lines.forEach(line => {
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end) + 1.5;

    line.classList.remove("active", "past");

    if (currentTime >= start && currentTime <= end) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end) {
      line.classList.add("past");
    }

    const words = line.querySelectorAll(".karaoke-live-word");
    words.forEach(word => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  });

  if (activeLine && activeLine !== lastActiveLine && autoScrollEnabled) {
    activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
    lastActiveLine = activeLine;
  }
}

async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) {
    alert("⚠️ Faltan ingredientes: Asegúrate de cargar una pista instrumental y grabar tu voz primero.");
    return;
  }

  const trackFile = karaokeSelectedTrackBlob;
  const btn = $("karaokeMixBtn");
  const resultDiv = $("karaokeMixResult");

  btn.textContent = "🎧 Mezclando audios... ⏳";
  btn.disabled = true;
  resultDiv.innerHTML = "<p style='color: var(--text-muted);'>Uniendo la pista y tu voz. Esto puede tardar unos segundos...</p>";

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const trackArrayBuffer = await trackFile.arrayBuffer();
    const trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer);

    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer();
    const voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer);

    const offlineCtx = new OfflineAudioContext(
      trackBuffer.numberOfChannels,
      trackBuffer.length,
      trackBuffer.sampleRate
    );

    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = 0.4;

    const trackSource = offlineCtx.createBufferSource();
    trackSource.buffer = trackBuffer;
    trackSource.connect(trackGain);
    trackGain.connect(offlineCtx.destination);

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.value = 2.5;

    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    trackSource.start(0);
    voiceSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const finalWavBlob = exportStereoWav(renderedBuffer);
    const finalUrl = URL.createObjectURL(finalWavBlob);

    resultDiv.innerHTML = `
      <h4 style="color: #22c55e;">✅ ¡Mezcla completada!</h4>
      <audio controls src="${finalUrl}" style="width: 100%; margin-bottom: 15px; border-radius: 8px;"></audio>
      <div style="display: flex; gap: 10px;">
        <a href="${finalUrl}" download="Mezcla_${trackFile.name || "Karaoke"}.wav" style="flex: 1;">
          <button type="button" style="width: 100%; background: #22c55e; color: black;">💾 Descargar Archivo</button>
        </a>
        <button id="saveMixToLibBtn" type="button" style="flex: 1; background: #3b82f6; color: white;">📁 Guardar en Biblioteca</button>
      </div>
    `;

    $("saveMixToLibBtn").onclick = async () => {
      const btnSave = $("saveMixToLibBtn");
      btnSave.textContent = "Guardando...";
      btnSave.disabled = true;

      await saveToLibrary(finalWavBlob, {
        name: `Mezcla - ${trackFile.name || "Canción"}`,
        type: "grabacion"
      });

      btnSave.textContent = "✅ ¡Guardado en Biblioteca!";
    };
  } catch (err) {
    console.error("Error al mezclar:", err);
    resultDiv.innerHTML = "<p style='color: #ef4444;'>❌ Hubo un error al mezclar los audios.</p>";
  } finally {
    btn.textContent = "🎧 Mezclar Pista + Voz";
    btn.disabled = false;
  }
}

function exportStereoWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const result = new ArrayBuffer(length);
  const view = new DataView(result);
  const channels = [];
  let pos = 0;

  const writeString = (viewObj, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      viewObj.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + buffer.length * 2 * numOfChan, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, buffer.length * 2 * numOfChan, true);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  pos = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numOfChan; channel++) {
      let sample = Math.max(-1, Math.min(1, channels[channel][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
  }

  return new Blob([result], { type: "audio/wav" });
}

// ==========================================
// SPLITTER IA
// ==========================================
async function splitAudio() {
  const fileInput = $("splitterFile");
  const file = fileInput?.files[0];

  if (!file) {
    alert("⚠️ Selecciona una canción primero.");
    return;
  }

  const btn = $("splitBtn");
  const statusBox = $("splitterStatusBox");
  const statusText = $("splitterStatusText");
  const detailText = $("splitterDetailText");

  btn.disabled = true;
  statusBox.style.display = "block";
  statusText.textContent = "1/4 📦 Subiendo canción...";
  detailText.textContent = "Enviando al casillero temporal seguro...";

  try {
    const formData = new FormData();
    formData.append("file", file);

    const tmpResponse = await fetch("https://tmpfiles.org/api/v1/upload", {
      method: "POST",
      body: formData
    });

    const tmpData = await tmpResponse.json();
    if (!tmpData.data || !tmpData.data.url) {
      throw new Error("Error al subir al casillero temporal.");
    }

    const directUrl = tmpData.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");

    statusText.textContent = "2/4 🚀 Iniciando Inteligencia Artificial...";
    detailText.textContent = "Despertando al modelo de alta calidad MDX23...";

    const startResponse = await fetch("/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: directUrl })
    });

    const prediction = await startResponse.json();
    if (!startResponse.ok) {
      throw new Error(prediction.error || "Error al conectar con Replicate");
    }

    statusText.textContent = "3/4 ⏳ IA separando pistas...";

    const interval = setInterval(async () => {
      try {
        const checkResponse = await fetch(`/api/split?id=${prediction.id}`);
        const statusData = await checkResponse.json();

        if (statusData.status === "succeeded") {
          clearInterval(interval);

          statusText.textContent = "4/4 🎧 Armando la pista final...";
          detailText.textContent = "Mezclando bajo, batería y melodía en una sola pista instrumental...";

          const urls = statusData.output;
          let vocalUrl = null;
          let instUrls = [];

          if (Array.isArray(urls)) {
            urls.forEach(u => u.toLowerCase().includes("vocal") ? (vocalUrl = u) : instUrls.push(u));
            if (!vocalUrl) {
              vocalUrl = urls[0];
              instUrls = urls.slice(1);
            }
          } else {
            for (const [key, value] of Object.entries(urls)) {
              if (key.toLowerCase().includes("vocal")) vocalUrl = value;
              else instUrls.push(value);
            }
          }

          const resVoz = await fetch(vocalUrl);
          const blobVoz = await resVoz.blob();

          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const buffers = [];

          for (const url of instUrls) {
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            buffers.push(await audioCtx.decodeAudioData(arrayBuffer));
          }

          const maxLength = Math.max(...buffers.map(b => b.length));
          const offlineCtx = new OfflineAudioContext(2, maxLength, buffers[0].sampleRate);

          buffers.forEach(buffer => {
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(offlineCtx.destination);
            source.start(0);
          });

          const renderedBuffer = await offlineCtx.startRendering();
          const blobPista = exportStereoWav(renderedBuffer);

          await saveToLibrary(blobVoz, { name: `Voz - ${file.name}`, type: "voz" });
          await saveToLibrary(blobPista, { name: `Pista - ${file.name}`, type: "pista" });

          statusText.textContent = "🎉 ¡Separación perfecta!";
          detailText.textContent = "Voz pura y Pista Instrumental guardadas en Biblioteca.";
          btn.disabled = false;
          btn.textContent = "✨ Separar Otra Canción";
        } else if (statusData.status === "failed" || statusData.status === "canceled") {
          clearInterval(interval);
          throw new Error("La IA falló al procesar el audio.");
        } else {
          detailText.textContent = `Estado de la IA: ${statusData.status}... por favor espera.`;
        }
      } catch (pollError) {
        clearInterval(interval);
        console.error(pollError);
        statusText.textContent = "❌ Error detectado";
        detailText.textContent = pollError.message || "Revisa la consola para más detalles.";
        btn.disabled = false;
        btn.textContent = "✨ Separar Audio con IA";
      }
    }, 4000);
  } catch (err) {
    console.error(err);
    statusText.textContent = "❌ Error detectado";
    detailText.textContent = err.message || "Revisa la consola para más detalles.";
    btn.disabled = false;
    btn.textContent = "✨ Separar Audio con IA";
  }
}

function showResult(url) {
  let container = document.getElementById("splitResult");

  if (!container) {
    container = document.createElement("div");
    container.id = "splitResult";
    container.style.marginTop = "20px";
    document.getElementById("splitter").appendChild(container);
  }

  container.innerHTML = `
    <p>✅ API respondió correctamente</p>
    <audio controls src="${url}"></audio>
    <br><br>
    <a href="${url}" download="resultado.mp3">
      <button>Descargar</button>
    </a>
  `;
}

// ==========================================
// CONFIGURACIÓN
// ==========================================
function saveSetting(key, element) {
  if (!element) return;
  localStorage.setItem(key, element.value);
  showSaveNotification();
}

function initSettings() {
  const settings = {
    micCount: "singIt_micCount",
    karaokeStage: "singIt_stage",
    difficultyLevel: "singIt_difficulty",
    userVoiceType: "singIt_voiceType",
    appTheme: "singIt_theme"
  };

  Object.entries(settings).forEach(([id, storageKey]) => {
    const el = $(id);
    if (el) {
      // Cargar valor guardado
      const saved = localStorage.getItem(storageKey);
      if (saved) el.value = saved;
      
      // Escuchar cambios
      el.addEventListener("change", (e) => {
        localStorage.setItem(storageKey, e.target.value);
        showSaveNotification();
        
        // Si es el tema, aplicarlo inmediatamente
        if (id === "appTheme") {
          applyAppTheme(e.target.value);
        }
      });
    }
  });

  // Aplicar tema guardado al iniciar
  applyAppTheme(localStorage.getItem("singIt_theme") || "oscuro");
}

function applyAppTheme(theme) {
  // Aplicamos el tema al elemento raíz (html)
  document.documentElement.setAttribute("data-theme", theme);
  
  // También al body por si acaso
  document.body.setAttribute("data-theme", theme);
  
  console.log("🎨 Tema aplicado:", theme);
}

// ==========================================
// SINCRONIZACIÓN MANUAL CON TAPS
// ==========================================
function startTapSync() {
  const lyricsText = $("lyricsText");
  const voicePlayer = $("selectedVoicePlayer");
  
  if (!lyricsText || !lyricsText.value.trim()) {
    alert("⚠️ Primero escribe o corrige la letra en el área de texto.");
    return;
  }
  
  if (!voicePlayer || !voicePlayer.src) {
    alert("⚠️ Primero carga una voz desde la Biblioteca.");
    return;
  }
  
  // Obtener líneas de la letra
  tapSyncLines = lyricsText.value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  if (tapSyncLines.length === 0) {
    alert("⚠️ No hay líneas de texto para sincronizar.");
    return;
  }
  
  // Reiniciar variables
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  tapSyncMode = true;
  
  // Mostrar/ocultar elementos
  $("startTapSyncBtn").style.display = "none";
  $("cancelTapSyncBtn").style.display = "inline-block";
  $("tapSyncActive").style.display = "block";
  $("tapSyncResult").style.display = "none";
  
  // Mostrar primera línea
  updateTapSyncDisplay();
  
  // Reproducir audio desde el inicio
  voicePlayer.currentTime = 0;
  voicePlayer.play();
  
  // Activar listener de teclado
  document.addEventListener("keydown", handleTapSyncKeypress);
  
  console.log("🎯 Sincronización iniciada. Líneas:", tapSyncLines.length);
}

function handleTapSyncKeypress(e) {
  if (!tapSyncMode) return;
  
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    recordTap();
  }
  
  if (e.code === "Escape") {
    cancelTapSync();
  }
}

function recordTap() {
  if (!tapSyncMode) return;
  
  const voicePlayer = $("selectedVoicePlayer");
  if (!voicePlayer) return;
  
  const currentTime = voicePlayer.currentTime;
  
  tapSyncTimestamps.push(currentTime);
  tapSyncCurrentIndex++;
  
  // Efecto visual
  const tapBtn = $("tapBeatBtn");
  if (tapBtn) {
    tapBtn.style.transform = "scale(0.95)";
    tapBtn.style.background = "linear-gradient(135deg, #16a34a, #14532d)";
    setTimeout(() => {
      tapBtn.style.transform = "scale(1)";
      tapBtn.style.background = "linear-gradient(135deg, #22c55e, #16a34a)";
    }, 100);
  }
  
  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    finishTapSync();
  } else {
    updateTapSyncDisplay();
  }
}

function updateTapSyncDisplay() {
  const currentLineEl = $("tapCurrentLine");
  const progressEl = $("tapProgress");
  
  if (currentLineEl && tapSyncCurrentIndex < tapSyncLines.length) {
    currentLineEl.textContent = tapSyncLines[tapSyncCurrentIndex];
  }
  
  if (progressEl) {
    progressEl.textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`;
  }
}

function finishTapSync() {
  tapSyncMode = false;
  
  const voicePlayer = $("selectedVoicePlayer");
  if (voicePlayer) voicePlayer.pause();
  
  document.removeEventListener("keydown", handleTapSyncKeypress);
  
  $("tapSyncActive").style.display = "none";
  $("tapSyncResult").style.display = "block";
  $("cancelTapSyncBtn").style.display = "none";
  
  console.log("✅ Sincronización completada. Timestamps:", tapSyncTimestamps);
}

function cancelTapSync() {
  tapSyncMode = false;
  
  const voicePlayer = $("selectedVoicePlayer");
  if (voicePlayer) voicePlayer.pause();
  
  document.removeEventListener("keydown", handleTapSyncKeypress);
  
  $("startTapSyncBtn").style.display = "inline-block";
  $("cancelTapSyncBtn").style.display = "none";
  $("tapSyncActive").style.display = "none";
  $("tapSyncResult").style.display = "none";
  
  tapSyncLines = [];
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
}

async function applyTapSync() {
  if (tapSyncTimestamps.length === 0 || tapSyncLines.length === 0) {
    alert("⚠️ No hay datos de sincronización.");
    return;
  }
  
  const voicePlayer = $("selectedVoicePlayer");
  const totalDuration = voicePlayer ? voicePlayer.duration : 0;
  const status = $("selectedVoiceStatus");
  
  // Mostrar estado
  if (status) status.textContent = "Estado: Aplicando tiempos y analizando notas...";
  
  const newSegments = [];
  
  for (let i = 0; i < tapSyncLines.length; i++) {
    const start = tapSyncTimestamps[i] || 0;
    let end = (i < tapSyncTimestamps.length - 1) ? tapSyncTimestamps[i + 1] : (totalDuration || start + 3);
    
    newSegments.push(buildWordTimingFromSegment({
      start: start,
      end: end,
      text: tapSyncLines[i]
    }));
  }
  
  // Analizar pitch si tenemos el blob de audio
  let analyzedSegments = newSegments;
  if (selectedVoiceBlob) {
    if (status) status.textContent = "Estado: Analizando notas musicales... 🎵";
    analyzedSegments = await analyzePitchForSegments(selectedVoiceBlob, newSegments);
  }
  
  baseTranscriptionSegments = analyzedSegments;
  transcriptionSegments = analyzedSegments;
  
  renderKaraokeLyrics(transcriptionSegments);
  cargarLetrasEnMonitor();
  
  if (selectedVoiceId) {
    updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments })
      .then(() => console.log("✅ Guardado en Biblioteca"))
      .catch(err => console.error("Error:", err));
  }
  
  $("startTapSyncBtn").style.display = "inline-block";
  $("tapSyncResult").style.display = "none";
  
  tapSyncLines = [];
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  
  if (status) status.textContent = "Estado: ✅ Sincronización y notas aplicadas";
  
  alert("✅ ¡Tiempos y notas aplicados! Reproduce para verificar.");
}


function redoTapSync() {
  $("tapSyncResult").style.display = "none";
  startTapSync();
}

async function applyCorrectedLyrics() {
  const lyricsText = $("lyricsText");
  const status = $("selectedVoiceStatus");

  if (!lyricsText) return;

  const correctedText = lyricsText.value.trim();

  if (!correctedText) {
    alert("⚠️ No hay texto corregido para aplicar.");
    return;
  }

  if (!Array.isArray(baseTranscriptionSegments) || !baseTranscriptionSegments.length) {
    alert("⚠️ Primero transcribe una voz antes de corregir la letra.");
    return;
  }

  const rebuiltSegments = buildSegmentsFromMultilineLyrics(
    correctedText,
    baseTranscriptionSegments
  );

  if (!rebuiltSegments.length) {
    alert("⚠️ No se pudo reconstruir la letra corregida.");
    return;
  }

  // Guardamos como nueva base la versión corregida
  baseTranscriptionSegments = rebuiltSegments;

  // Mostramos exactamente las líneas escritas por el usuario
  transcriptionSegments = rebuiltSegments;

  renderKaraokeLyrics(transcriptionSegments);
  cargarLetrasEnMonitor();

  lyricsText.value = transcriptionSegments
    .map(seg => seg.text || "")
    .join("\n")
    .trim();

  if (selectedVoiceId) {
    try {
      await updateLibraryItem(selectedVoiceId, {
        transcription: baseTranscriptionSegments
      });

      if (status) {
        status.textContent = "Estado: letra corregida aplicada y guardada ✅";
      }
    } catch (error) {
      console.error(error);
      if (status) {
        status.textContent = "Estado: letra corregida aplicada, pero no se pudo guardar en BD";
      }
    }
  } else {
    if (status) {
      status.textContent = "Estado: letra corregida aplicada ✅";
    }
  }
}

// ==========================================
// MONITOR DE KARAOKE (CANVAS)
// ==========================================
function drawKaraokeMonitor(currentTime, currentFreq) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Guardamos la frecuencia actual
  pitchHistory.push(currentFreq > 0 ? currentFreq : null);
  if (pitchHistory.length > 60) pitchHistory.shift();

  // Limpiamos el canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Configuración del pentagrama
  const pentagramTop = 30;
  const pentagramBottom = canvas.height - 60;
  const pentagramHeight = pentagramBottom - pentagramTop;
  
  // Rango de notas (MIDI): C3 (48) a C6 (84)
  const midiMin = 48;
  const midiMax = 84;
  const midiRange = midiMax - midiMin;

  // --- DIBUJAR LÍNEAS DEL PENTAGRAMA ---
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  const numLines = 12;
  for (let i = 0; i <= numLines; i++) {
    const y = pentagramTop + (pentagramHeight / numLines) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // --- DIBUJAR INDICADORES DE NOTAS A LA IZQUIERDA ---
  ctx.fillStyle = "#666";
  ctx.font = "10px Arial";
  ctx.textAlign = "right";
  const noteLabels = ["C6", "A5", "F5", "D5", "B4", "G4", "E4", "C4", "A3", "F3", "D3", "C3"];
  noteLabels.forEach((label, i) => {
    const y = pentagramTop + (pentagramHeight / numLines) * i + 4;
    ctx.fillText(label, 25, y);
  });

  // Función para convertir MIDI a posición Y
  function midiToY(midi) {
    if (!midi || midi < midiMin) midi = midiMin;
    if (midi > midiMax) midi = midiMax;
    const normalized = (midiMax - midi) / midiRange;
    return pentagramTop + normalized * pentagramHeight;
  }

  // --- DIBUJAR BARRAS DE NOTAS (ULTRASTAR STYLE) ---
  if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
    
    // Ventana de tiempo visible (5 segundos hacia adelante, 1 hacia atrás)
    const timeWindowStart = currentTime - 1;
    const timeWindowEnd = currentTime + 5;
    const pixelsPerSecond = (canvas.width - 40) / 6; // 6 segundos de ventana
    const lineX = 40; // Línea de tiempo actual

    // Dibujar línea de tiempo actual
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX, pentagramTop);
    ctx.lineTo(lineX, pentagramBottom);
    ctx.stroke();

    // Recorrer todos los segmentos
    transcriptionSegments.forEach((segment) => {
      const words = Array.isArray(segment.words) ? segment.words : [];
      
      words.forEach((word) => {
        // Verificar si está en la ventana visible
        if (word.end < timeWindowStart || word.start > timeWindowEnd) return;
        
        // Calcular posición X basada en el tiempo
        const wordStartX = lineX + (word.start - currentTime) * pixelsPerSecond;
        const wordEndX = lineX + (word.end - currentTime) * pixelsPerSecond;
        const barWidth = Math.max(wordEndX - wordStartX, 20);
        
        // Posición Y basada en la nota MIDI
        const midi = word.midi || segment.midi || 60; // Default: C4
        const barY = midiToY(midi);
        const barHeight = 22;
        
        // Determinar si la palabra está activa
        const isActive = currentTime >= word.start && currentTime <= word.end;
        const isPast = currentTime > word.end;
        
        // Determinar si el usuario está cantando la nota correcta
        let isCorrect = false;
        if (isActive && currentFreq > 0) {
          const userMidi = frequencyToMidi(currentFreq);
          isCorrect = Math.abs(userMidi - midi) <= 2; // Tolerancia de 2 semitonos
        }
        
        // Colores según estado
        let barColor, textColor, borderColor;
        if (isPast) {
          barColor = "#4b5563"; // Gris
          textColor = "#9ca3af";
          borderColor = "#6b7280";
        } else if (isActive) {
          if (isCorrect) {
            barColor = "#22c55e"; // Verde - ¡Correcto!
            textColor = "#ffffff";
            borderColor = "#4ade80";
          } else {
            barColor = "#3b82f6"; // Azul - Activo
            textColor = "#ffffff";
            borderColor = "#60a5fa";
          }
        } else {
          barColor = "#1e40af"; // Azul oscuro - Próximo
          textColor = "#93c5fd";
          borderColor = "#3b82f6";
        }
        
        // Dibujar barra con bordes redondeados
        ctx.fillStyle = barColor;
        ctx.beginPath();
        ctx.roundRect(wordStartX, barY - barHeight/2, barWidth, barHeight, 8);
        ctx.fill();
        
        // Borde
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();
        
        // Texto de la palabra
        ctx.fillStyle = textColor;
        ctx.font = isActive ? "bold 12px Arial" : "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        // Truncar si es muy largo
        let displayWord = word.word || "";
        if (displayWord.length > 10) {
          displayWord = displayWord.substring(0, 8) + "..";
        }
        ctx.fillText(displayWord, wordStartX + barWidth/2, barY);
      });
    });

  } else {
    ctx.fillStyle = "#666";
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas", canvas.width / 2, canvas.height / 2);
  }

  // --- DIBUJAR LA VOZ DEL USUARIO (LÍNEA/PUNTO) ---
  if (currentFreq > 0) {
    const userMidi = frequencyToMidi(currentFreq);
    const userY = midiToY(userMidi);
    
    // Punto grande en la posición actual
    ctx.beginPath();
    ctx.fillStyle = "#facc15";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#facc15";
    ctx.arc(40, userY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Rastro de la voz
    ctx.beginPath();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
    ctx.lineWidth = 3;
    
    let started = false;
    pitchHistory.forEach((freq, i) => {
      if (freq) {
        const midi = frequencyToMidi(freq);
        const y = midiToY(midi);
        const x = 40 - (pitchHistory.length - i) * 2;
        
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    ctx.stroke();
  }

  // --- DIBUJAR LETRA ACTUAL ABAJO ---
  const currentSegment = transcriptionSegments.find(seg => 
    currentTime >= seg.start && currentTime <= seg.end + 0.5
  );
  
  if (currentSegment) {
    // Fondo para la letra
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
    
    // Letra actual
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(currentSegment.text || "", canvas.width / 2, canvas.height - 25);
  }

  // --- DIBUJAR SIGUIENTE LÍNEA ---
  const nextSegment = transcriptionSegments.find(seg => seg.start > currentTime);
  if (nextSegment && !currentSegment) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
    
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Próximo: " + (nextSegment.text || ""), canvas.width / 2, canvas.height - 25);
  }
}

// ==========================================
// DETECCIÓN DE PITCH PARA KARAOKE
// ==========================================
async function startKaraokePitchDetection() {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Obtener micrófono seleccionado
    const micId = getSelectedMicId(1);
    
    const audioConstraints = { 
        audio: micId ? { deviceId: { exact: micId } } : true 
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
    const mic = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    mic.connect(analyser);

    function loop() {
        const track = $("karaokeTrack");
        const currentTime = track ? track.currentTime : 0;

        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        const pitch = autoCorrelate(buffer, audioCtx.sampleRate);

        drawKaraokeMonitor(currentTime, pitch);

        // Si la pista terminó, paramos
        if (track && track.ended) return;

        // Seguimos el loop mientras se graba
        if (karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") {
            requestAnimationFrame(loop);
        }
    }

    loop();
}

// ==========================================
// CATÁLOGO Y MIS CANCIONES
// ==========================================
async function loadKaraokeCatalog() {
  const container = $("catalogList");
  if (!container) return;
  
  container.innerHTML = `<p style="color: var(--text-muted);">Cargando catálogo...</p>`;
  
  try {
    // Cargar el catálogo desde el repositorio
    const response = await fetch("./karaoke-catalog/catalog.json");
    
    if (!response.ok) {
      throw new Error("No se pudo cargar el catálogo");
    }
    
    const catalog = await response.json();
    
    if (!catalog.songs || catalog.songs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>📚 El catálogo está vacío.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = "";
    
    catalog.songs.forEach(song => {
      const div = document.createElement("div");
      div.className = "catalog-item";
      
      div.innerHTML = `
        <div class="catalog-item-info">
          <p class="catalog-item-title">🎵 ${song.title}</p>
          <p class="catalog-item-artist">${song.artist}</p>
        </div>
        <div class="catalog-item-actions">
          <button type="button" class="load-catalog-btn" data-folder="${song.folder}" data-title="${song.title}" data-artist="${song.artist}" style="background: #22c55e;">▶️ Cantar</button>
        </div>
      `;
      
      container.appendChild(div);
    });
    
    // Agregar eventos a los botones
    container.querySelectorAll(".load-catalog-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        loadCatalogSong(btn.dataset.folder, btn.dataset.title, btn.dataset.artist);
      });
    });
    
    console.log("📚 Catálogo cargado:", catalog.songs.length, "canciones");
    
  } catch (error) {
    console.error("Error cargando catálogo:", error);
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        <p>📚 No se pudo cargar el catálogo.</p>
        <p style="font-size: 13px;">Importa canciones de UltraStar o crea las tuyas en Estudio.</p>
      </div>
    `;
  }
}

async function loadCatalogSong(folder, title, artist) {
  const status = $("karaokeStatus");
  
  try {
    if (status) status.textContent = `Estado: Cargando "${title}"...`;
    
    // Cargar el archivo de sincronización
    const syncResponse = await fetch(`./karaoke-catalog/${folder}/sync.txt`);
    if (!syncResponse.ok) {
      throw new Error("No se pudo cargar la sincronización");
    }
    const syncContent = await syncResponse.text();
    
    // Parsear el archivo UltraStar
    const parsed = parseUltrastarTxt(syncContent);
    const segments = ultrastarToSegments(parsed);
    
    if (segments.length === 0) {
      throw new Error("No se pudieron extraer las notas");
    }
    
    // Cargar el audio
    const audioResponse = await fetch(`./karaoke-catalog/${folder}/audio.mp3`);
    if (!audioResponse.ok) {
      throw new Error("No se pudo cargar el audio");
    }
    const audioBlob = await audioResponse.blob();
    
    // Configurar el reproductor
    const track = $("karaokeTrack");
    if (track) {
      track.src = URL.createObjectURL(audioBlob);
      track.volume = 0.4;
      karaokeSelectedTrackBlob = audioBlob;
      karaokeSelectedTrackName = `${title} - ${artist}`;
    }
    
    // Configurar la sincronización
    transcriptionSegments = segments;
    baseTranscriptionSegments = segments;
    cargarLetrasEnMonitor();
    
    if (status) status.textContent = `Estado: "${title}" cargada. ¡Lista para cantar! 🎤`;
    
    // Scroll al monitor
    const canvas = $("karaokeCanvas");
    if (canvas) {
      canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    
    console.log("✅ Canción del catálogo cargada:", title);
    
  } catch (error) {
    console.error("Error cargando canción del catálogo:", error);
    if (status) status.textContent = `Estado: Error al cargar "${title}"`;
    alert(`❌ Error al cargar la canción: ${error.message}`);
  }
}

async function loadMyKaraokeSongs() {
    const container = $("myKaraokeList");
    if (!container) return;
    
    try {
        // 1. Obtener canciones tipo "karaoke" (ej: importadas de UltraStar)
        const karaokeSongs = await getLibraryItemsByType("karaoke");
        
        // 2. Obtener voces que tengan transcripción
        const voces = await getLibraryItemsByType("voz");
        const vocesConSync = voces.filter(v => v.transcription && v.transcription.length > 0);
        
        // 🔥 MEJORA DE UNIFICACIÓN: Obtener también las PISTAS instrumentales que ya sincronizamos en el Estudio
        const pistas = await getLibraryItemsByType("pista");
        const pistasConSync = pistas.filter(p => p.transcription && p.transcription.length > 0);
        
        // Juntamos absolutamente todo en una sola lista unificada de canciones listas
        const allSongs = [...karaokeSongs, ...vocesConSync, ...pistasConSync];
        
        if (allSongs.length === 0) {
            container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
              <p>No tienes canciones listas aún.</p>
              <p style="font-size: 13px;">Importa de UltraStar o sincroniza una pista o voz en la pestaña Estudio.</p>
            </div>
            `;
            return;
        }
        
        container.innerHTML = "";
        
        allSongs.forEach(song => {
            const div = document.createElement("div");
            div.className = "my-karaoke-item";
            
            // Si es un archivo unificado en el Estudio, usamos iconos descriptivos para que sepa el usuario de dónde viene
            let icono = "🎤"; 
            if (song.type === "pista") icono = "🎵";
            if (song.type === "karaoke") icono = "🌟";

            const title = song.metadata?.title || song.name || "Sin título";
            const artist = song.metadata?.artist || "";
            
            div.innerHTML = `
            <div class="my-karaoke-item-info">
              <p class="my-karaoke-item-title">${icono} ${title}</p>
              <p class="my-karaoke-item-artist">${artist || "Archivo Local Sincronizado ✨"}</p>
            </div>
            <div class="my-karaoke-item-actions">
              <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #22c55e;">▶️ Cantar</button>
              <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 8px 10px;">🗑️</button>
            </div>
            `;
            container.appendChild(div);
        });
      } catch (error) {
        console.error("Error cargando mis canciones:", error);
        container.innerHTML = `<p style="color: #ef4444;">Error al cargar canciones</p>`;
    }
}

async function loadKaraokeSong(id) {
  try {
    const song = await getLibraryItemById(id);
    if (!song) {
      alert("⚠️ Canción no encontrada");
      return;
    }
    
    // Cargar pista
    const track = $("karaokeTrack");
    if (track && song.audioBlob) {
      track.src = URL.createObjectURL(song.audioBlob);
      track.volume = 0.4;
      karaokeSelectedTrackBlob = song.audioBlob;
      karaokeSelectedTrackName = song.name;
    }
    
    // Cargar transcripción
    if (song.transcription && song.transcription.length > 0) {
      transcriptionSegments = song.transcription;
      baseTranscriptionSegments = song.transcription;
      cargarLetrasEnMonitor();
    }
    
    const title = song.metadata?.title || song.name;
    $("karaokeStatus").textContent = `Estado: "${title}" cargada. ¡Lista para cantar! 🎤`;
    
    // Scroll al monitor
    $("karaokeCanvas").scrollIntoView({ behavior: "smooth", block: "center" });
    
  } catch (error) {
    console.error("Error cargando canción:", error);
    alert("❌ Error al cargar la canción");
  }
}
