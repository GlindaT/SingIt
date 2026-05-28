// Reutilizar el buffer para el afinador
const pitchBuffer = new Float32Array(2048);

// ==========================================
// CONFIG GLOBAL
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
let autoScrollEnabled = true; // Control de auto-scroll

// Variables para sincronización con Taps
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

function $(id) {
  return document.getElementById(id);
}

function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

let pitchHistoryMic1 = [];
let pitchHistoryMic2 = [];

// ==========================================
// INDEXED DB - BIBLIOTECA
// ==========================================
function initDB() {
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

function addLibraryItem(item) {
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

function getAllLibraryItems() {
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

function updateLibraryItem(id, changes) {
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

function deleteLibraryItemFromDB(id) {
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

function getLibraryItemsByType(type) {
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

function getLibraryItemById(id) {
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

// ==========================================
// NAVEGACIÓN
// ==========================================
function showTab(tabId) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  const target = $(tabId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".sidebar button").forEach(btn => {
    btn.classList.remove("active");
  });

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
}

function inicializarMenuSensibilidad() {
  const select = document.getElementById("sensitivitySelect");
  if (!select) return;

  // Leemos lo que haya guardado en el disco del navegador
  const sensibilidadGuardada = localStorage.getItem("singIt_sensitivity");

  // Si el usuario ya había guardado algo antes, forzamos al menú a mostrar esa opción
  if (sensibilidadGuardada) {
    select.value = sensibilidatGuardada;
  } else {
    // Si la app es nueva para el usuario, forzamos al menú a marcar la recomendada
    select.value = "0.015"; 
  }
}

function guardarSensibilidadGlobal(nuevoValor) {
  // Convertimos a flotante para asegurar que se guarde de forma numérica pura
  localStorage.setItem("singIt_sensitivity", parseFloat(nuevoValor));
  
  // Si tienes tu notificación de guardado, se activa
  if (typeof showSaveNotification === "function") {
    showSaveNotification();
  }
}

function cargarConfiguracionesVisuales() {
  const slider = document.getElementById("micSensitivity");
  if (!slider) return;

  // Leemos el disco del navegador
  const sensibilidadGuardada = localStorage.getItem("singIt_sensitivity");

  if (sensibilidadGuardada) {
    // Si ya existe un valor guardado, forzamos al slider a posicionarse ahí
    slider.value = sensibilidadGuardada;
  } else {
    // Si es la primera vez del usuario, forzamos a que el slider inicie en tu recomendado
    slider.value = "0.015";
    localStorage.setItem("singIt_sensitivity", 0.015);
  }
}

// ==========================================
// AFINADOR
// ==========================================
let audioContext, analyser, stream;

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

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
  
  const mic = audioContext.createMediaStreamSource(stream);
  
  // --- AQUÍ APLICAMOS LA LIMPIEZA ---
  const cadenaLimpia = aplicarCadenaDeAudio(audioContext, mic);
  
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  
  // Conectamos la salida de la cadena al analizador
  cadenaLimpia.connect(analyser);
  
  setTimeout(() => {
    detectPitch();
  }, 300);
}

function aplicarCadenaDeAudio(audioCtx, source) {
  // 1. Filtro Paso Alto (Elimina zumbidos graves de 80Hz hacia abajo)
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 80;

  // 2. Filtro Paso Bajo (Elimina siseos eléctricos de 1000Hz hacia arriba)
  const lowPass = audioCtx.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = 1000;

  // 3. Control de Ganancia (Un poco de volumen extra)
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.5;

  // Conectamos: Fuente -> HighPass -> LowPass -> Gain -> Salida
  source.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(gainNode);
  
  return gainNode; // Retornamos el último nodo para conectarlo al Analyser
}

// ====================================================================
// 🔥 NUEVA FUNCIÓN: CADENA DE AUDIO DE ALTA CALIDAD PARA KARAOKE Y ESTUDIO
// ====================================================================
function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
  
  // 1. Filtro Paso Alto (Elimina ruidos de golpes al micrófono)
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 60;
  
  // 2. 🔥 NUEVO: COMPRESOR DE AUDIO DINÁMICO
  const compresor = audioCtx.createDynamicsCompressor();
  compresor.threshold.setValueAtTime(-24, audioCtx.currentTime); // Límite de volumen
  compresor.knee.setValueAtTime(30, audioCtx.currentTime);       // Transición suave
  compresor.ratio.setValueAtTime(4, audioCtx.currentTime);        // Fuerza de compresión
  compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);   // Reacción inmediata (3ms)
  compresor.release.setValueAtTime(0.25, audioCtx.currentTime);   // Relajación natural (250ms)
  
  // 3. Filtro de Brillo (Realce profesional en agudos)
  const shelfFilter = audioCtx.createBiquadFilter();
  shelfFilter.type = "highshelf";
  shelfFilter.frequency.value = 4000; 
  shelfFilter.gain.value = 2.0; 
  
  // 4. Ganancia base para la mezcla final
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.4; 
  
  // CONEXIÓN EN CADENA INTERNA:
  // Fuente -> Filtro Graves -> ¡COMPRESOR! -> Filtro Brillo -> Volumen -> Salida
  source.connect(highPass);
  highPass.connect(compresor);
  compresor.connect(shelfFilter);
  shelfFilter.connect(gainNode);
  
  return gainNode; 
}

function stopAfinador() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
}

function detectPitch() {
  if (!state.isRecording || !analyser) return;

  // Usamos el buffer global en lugar de crear uno nuevo cada 16ms
  analyser.getFloatTimeDomainData(pitchBuffer);
  const pitch = autoCorrelate(pitchBuffer, audioContext.sampleRate);
  
  if (document.getElementById("karaokeCanvas")) {
    // Asegúrate de que esta función esté definida o comentada para evitar errores
    if (typeof drawKaraokeMonitor === 'function') drawKaraokeMonitor(0, pitch); 
  }

  const display = $("noteDisplay");
  const guide = $("guideText");
  const targetNoteEl = $("targetNote");
  const targetNote = targetNoteEl ? targetNoteEl.value : "E2";

  if (display && guide) {
    if (pitch !== -1) {
      const noteFull = getNoteFromFrequency(pitch);
      const targetFreq = getNoteFrequency(targetNote);
      // Evitar logaritmo de 0 o infinito
      const cents = 1200 * Math.log2(pitch / targetFreq);

      display.textContent = noteFull;

      const dificultad = localStorage.getItem("singIt_difficulty") || "medio";
      let maxDesviation = 30;
      if (dificultad === "facil") maxDesviation = 50;
      else if (dificultad === "dificil") maxDesviation = 15;
      else if (dificultad === "experto") maxDesviation = 5;
        
        // Asegúrate de que las llaves envuelven correctamente cada bloque
        if (Math.abs(cents) <= maxDesviation) {
            display.style.color = "#22c55e"; 
            guide.textContent = `🎯 ¡En la nota! (${targetNote})`;
            guide.style.color = "#22c55e";
        } else if (cents < 0) {
            display.style.color = "#f59e0b";
            guide.textContent = `⬆️ Estás grave. Sube a ${targetNote}`;
            guide.style.color = "#f59e0b";
        } else {
            display.style.color = "#f59e0b";
            guide.textContent = `⬇️ Estás agudo. Baja a ${targetNote}`;
            guide.style.color = "#f59e0b";
        }
    } else {
      display.textContent = "--";
      display.style.color = "white";
      guide.textContent = "🎤 Esperando voz...";
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
  for (let i = 0; i < buf.length; i++) {
    rms += buf[i] * buf[i];
  }
  rms = Math.sqrt(rms / buf.length);

  const umbral = parseFloat(localStorage.getItem("singIt_sensitivity")) || 0.015;

  // Si el volumen es muy bajo, ignoramos la detección
  if (rms < umbral) return -1;

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

  // Ignorar frecuencias absurdas para voz humana cantada
  if (frequency < 60 || frequency > 1200) return -1;

  return frequency;
}
// ==========================================
// ESTADO ESTUDIO / BIBLIOTECA
// ==========================================
let studioMediaRecorder = null;
let studioStream = null;
let studioChunks = [];
let studioRecordedBlob = null;
let studioTrackFileName = "";
let studioTrackBlob = null;
let studioTrackId = null;
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let studioSelectedTrackBlob = null;
let studioSelectedTrackName = "";
let studioSelectedTrackId = null;

// ==========================================
// ESTUDIO
// ==========================================
function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;

  studioTrackFileName = file.name;
  studioTrackBlob = file;
  studioTrackId = null;

  const url = URL.createObjectURL(file);
  $("player").src = url;
  $("studioStatus").textContent = `Estado: pista cargada (${file.name})`;
}

function playTrack() {
  const player = $("player");

  if (!player || !player.src) {
    alert("⚠️ Primero sube una pista");
    return;
  }

  player.play();
}

function pauseTrack() {
  const player = $("player");
  if (player) player.pause();
}

function stopTrack() {
  const player = $("player");
  if (!player) return;

  player.pause();
  player.currentTime = 0;
  updateKaraokeHighlight(0);
}

// Variables para grabación dúo
let studioStream2 = null;
let duoAudioContext = null;
let duoAnalyser1 = null;
let duoAnalyser2 = null;
let duoAnimationId = null;

async function startStudioRecording() {
  try {
    const player = $("player");
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    studioChunks = [];
    studioRecordedBlob = null;
    $("voicePlayer").src = "";
    $("studioStatus").textContent = "Estado: preparando grabación...";

    // Contexto de audio unificado para aplicar filtros. Agregada may 25
    duoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = duoAudioContext.createMediaStreamDestination();

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
    studioStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints1});

    // Procesar Mic 1 con tus filtros. Agregada may 25
    const source1 = duoAudioContext.createMediaStreamSource(studioStream);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, source1);

    /// Control de volumen Mic 1. May 25
    const volNode1 = duoAudioContext.createGain();
    volNode1.gain.value = 0.75;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; // Guardar referencia global

    duoAnalyser1 = duoAudioContext.createAnalyser();
    duoAnalyser1.fftSize = 256;
    volNode1.connect(duoAnalyser1);

    const merger = duoAudioContext.createChannelMerger(2);
    duoAnalyser1.connect(merger, 0, 0);

    // Si es mono, duplicamos el canal para que no se oiga de un solo lado. May 25
    if (!isDuo) {
      duoAnalyser1.connect(merger, 0, 1);
    }

    // Si es DÚO, obtener y mezclar Mic 2
    if (isDuo && mic2Id) {
      const audioConstraints2 = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000
      };
      if (mic2Id) audioConstraints2.deviceId = { exact: mic2Id };
       
      studioStream2 = await navigator.mediaDevices.getUserMedia({audio: audioConstraints2});

      // Procesar Mic 2 con tus filtros. May 25
      const source2 = duoAudioContext.createMediaStreamSource(studioStream2);
      const mic2Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, source2);

      // Control de volumen Mic 2. May 25
      const volNode2 = duoAudioContext.createGain();
      volNode2.gain.value = 0.75;
      mic2Filtrado.connect(volNode2);
      currentVolNode2 = volNode2; // Guardar referencia global

      duoAnalyser2 = duoAudioContext.createAnalyser();
      duoAnalyser2.fftSize = 256;
      volNode2.connect(duoAnalyser2);

      duoAnalyser2.connect(merger, 0, 1);

      const duoIndicator = $("duoIndicator");
      if (duoIndicator) duoIndicator.style.display = "block";
    }

    merger.connect(destination);
    let finalStream = destination.stream;

    startDuoLevelMonitor();

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    studioMediaRecorder = new MediaRecorder(finalStream, options);

    studioMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) studioChunks.push(event.data);
    };

    studioMediaRecorder.onstop = () => {
      studioRecordedBlob = new Blob(studioChunks, { type: "audio/webm" });
      $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
      $("studioStatus").textContent = "Estado: grabación lista";
      stopDuoLevelMonitor();
    };

    studioMediaRecorder.start();
    
    // Mostrar estado
    const mic1Select = $("mic1Select");
    const mic1Name = mic1Select ? mic1Select.options[mic1Select.selectedIndex]?.text : "Predeterminado";
    
    if (isDuo && mic2Id) {
      const mic2Select = $("mic2Select");
      const mic2Name = mic2Select ? mic2Select.options[mic2Select.selectedIndex]?.text : "Mic 2";
      $("studioStatus").textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name})...`;
    } else {
      $("studioStatus").textContent = `Estado: 🔴 Grabando con ${mic1Name}...`;
    }

    if (player && player.src) {
      player.currentTime = 0;
      player.play();
    }
  } catch (error) {
    console.error(error);
    $("studioStatus").textContent = "Estado: error al acceder al micrófono";
    alert("❌ No se pudo acceder al micrófono. Verifica en Configuración.");
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

  // Resetear barras
  const level1 = $("duoMic1Level");
  const level2 = $("duoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

function stopStudioRecording() {
  if (studioMediaRecorder && studioMediaRecorder.state !== "inactive") {
    studioMediaRecorder.stop();
  }

  // Detener Mic 1
  if (studioStream) {
    studioStream.getTracks().forEach(track => track.stop());
  }

  // Detener Mic 2 (si existe)
  if (studioStream2) {
    studioStream2.getTracks().forEach(track => track.stop());
    studioStream2 = null;
  }

  // Cerrar contexto de audio dúo
  if (duoAudioContext) {
    duoAudioContext.close();
    duoAudioContext = null;
  }

  duoAnalyser1 = null;
  duoAnalyser2 = null;

  stopDuoLevelMonitor();

  // Ocultar indicador
  const duoIndicator = $("duoIndicator");
  if (duoIndicator) {
    duoIndicator.style.display = "none";
  }

  const player = $("player");
  if (player) {
    player.pause();
  }
}

function redoStudioRecording() {
  studioChunks = [];
  studioRecordedBlob = null;
  $("voicePlayer").src = "";
  $("studioStatus").textContent = "Estado: grabación eliminada. Lista para volver a grabar.";
}

function saveStudioRecording() {
  if (!studioRecordedBlob) {
    alert("⚠️ No hay grabación para guardar");
    return;
  }

  const baseName = studioTrackFileName
    ? `Voz - ${studioTrackFileName}`
    : "Grabación de voz";

  saveToLibrary(studioRecordedBlob, {
    name: baseName,
    type: "voz"
  });

  $("studioStatus").textContent = "Estado: grabación guardada en Biblioteca";
}



// ==========================================
// BIBLIOTECA
// ==========================================
async function saveToLibrary(blob, options = {}) {
  try {
    await addLibraryItem({
      name: options.name || "Archivo",
      type: options.type || "audio",
      audioBlob: blob || null, // Permite nulos si es texto
      textoPlano: options.textoPlano || null, // Compatibilidad con el nuevo formato
      date: new Date().toLocaleString("es-ES"),
      transcription: options.transcription || [] 
    });

    await renderLibrary(options.type || 'todos');
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo guardar en Biblioteca");
  }
}

async function renderLibrary(filter = 'todos') {
  const container = $("libraryList");
  if (!container) return;

  // ==========================================
  // SOLUCIÓN 1: ILUMINAR LA CARPETA SELECCIONADA
  // ==========================================
  document.querySelectorAll(".folder-btn").forEach(btn => {
    // Comprobamos si el evento onclick incluye el tipo de filtro actual
    if (btn.getAttribute("onclick").includes(`'${filter}'`)) {
      btn.classList.add("active"); // Ilumina la carpeta actual
    } else {
      btn.classList.remove("active"); // Apaga las carpetas inactivas
    }
  });

  container.innerHTML = "<p>Cargando archivos...</p>";
  
  try {
    let library = await getAllLibraryItems();

    // Filtramos según la carpeta seleccionada
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

        // Condicional: Si es un archivo de texto UltraStar
        if (item.type === 'ultrastar_txt') {
          // Cortamos el texto para mostrar solo un adelanto de las primeras líneas
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
        // Si es cualquier otro archivo (pista, voz, grabación, karaoke con audio)
        else {
          // Validamos que exista el blob antes de crear la URL para evitar errores accidentales
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
    
    // Reactivar botones de borrar
    document.querySelectorAll(".delete-library-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        await deleteLibraryItem(id);
        renderLibrary(filter); 
      });
    });
    
    // ========================================================
    // SOLUCIÓN 2: CORRECCIÓN DEL ID PARA CARGAR EN EL MONITOR
    // ========================================================
    document.querySelectorAll(".load-monitor-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const item = library.find(i => i.id === id);
        
        if (item && item.textoPlano) {
          // 🎯 CORRECCIÓN: Buscamos "lyricsText" (el ID real de tu monitor del Estudio)
          const monitor = document.getElementById("lyricsText") || document.getElementById("miniMonitorTextArea");
          
          if (monitor) {
            monitor.value = item.textoPlano;
            
            // Si el archivo UltraStar contiene los tiempos de los taps guardados en memoria, los reactivamos
            if (item.transcription) {
              baseTranscriptionSegments = item.transcription;
              transcriptionSegments = item.transcription;
              
              if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();
              if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
            }

            alert(`✅ Letra de "${item.name}" cargada en el monitor del Estudio.`);
            
            // Scroll suave automático directo al monitor de texto para empezar a trabajar
            monitor.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            alert("⚠️ No se encontró el contenedor visual del monitor en esta pantalla.");
          }
        }
      });
    });

    // Actualizamos los selectores del Estudio y Karaoke para que vean los cambios
    if (typeof loadVoiceOptionsInStudio === "function") await loadVoiceOptionsInStudio();
    if (typeof loadTrackOptionsInStudio === "function") await loadTrackOptionsInStudio();
    if (typeof loadTrackOptionsInKaraoke === "function") await loadTrackOptionsInKaraoke();
  
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>❌ Error al cargar la biblioteca.</p>";
  }
}

async function deleteLibraryItem(id) {
  try {
    await deleteLibraryItemFromDB(id);
    await renderLibrary('todos');
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo eliminar el archivo");
  }
}

async function saveManualFileToLibrary() {
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
    // CASO A: Es un archivo de texto UltraStar
    if (selectedType === "ultrastar_txt") {
      // Leemos el contenido real del archivo .txt como texto plano
      const textoPlano = await file.text();
      
      await addLibraryItem({
        name: customName,
        type: selectedType,
        audioBlob: null, // No lleva audio
        textoPlano: textoPlano, // Guardamos la letra sincronizada aquí
        date: new Date().toLocaleString("es-ES"),
        transcription: []
      });
    } 
    // CASO B: Es cualquier archivo de audio (pista, voz, grabación)
    else {
      await addLibraryItem({
        name: customName,
        type: selectedType,
        audioBlob: file, // Guardamos el archivo binario de audio directamente
        date: new Date().toLocaleString("es-ES"),
        transcription: []
      });
    }

    // Limpiar el formulario tras guardar con éxito
    fileInput.value = "";
    if (nameInput) nameInput.value = "";
    
    // Refrescar la carpeta en la que nos encontramos
    await renderLibrary(selectedType);
    alert(`✅ ¡"${customName}" guardado en la biblioteca con éxito!`);

  } catch (error) {
    console.error("Error al guardar archivo manualmente:", error);
    alert("❌ Ocurrió un error al procesar y guardar tu archivo.");
  }
}

async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;

  try {
    const tracks = await getLibraryItemsByType("pista");

    if (!tracks.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No hay pistas guardadas";
      select.appendChild(option);
      return;
    }

    tracks.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} (${item.date || "sin fecha"})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect");
  const player = $("player");
  const status = $("studioStatus");

  if (!select || !player || !status) return;

  const selectedId = Number(select.value);

  if (!selectedId) {
    alert("⚠️ Selecciona una pista");
    return;
  }

  try {
    const item = await getLibraryItemById(selectedId);

    if (!item) {
      alert("⚠️ No se encontró la pista");
      return;
    }

    studioTrackFileName = item.name;
    studioTrackBlob = item.audioBlob;
    studioTrackId = item.id;

    studioSelectedTrackName = item.name;
    studioSelectedTrackBlob = item.audioBlob;
    studioSelectedTrackId = item.id;
    
    player.src = URL.createObjectURL(item.audioBlob);
    status.textContent = `Estado: pista cargada desde Biblioteca (${item.name})`;
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar la pista seleccionada");
  }
}

async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;

  try {
    const voces = await getLibraryItemsByType("voz");
    const grabaciones = await getLibraryItemsByType("grabación");

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

async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect");
  const player = $("selectedVoicePlayer");
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  if (!select || !player || !status) return;

  const selectedId = Number(select.value);

  if (!selectedId) {
    alert("⚠️ Selecciona una voz");
    return;
  }

  try {
    const item = await getLibraryItemById(selectedId);

    if (!item) {
      alert("⚠️ No se encontró el archivo");
      return;
    }

    selectedVoiceBlob = item.audioBlob;
    selectedVoiceId = item.id;

    const audioURL = URL.createObjectURL(item.audioBlob);
    player.src = audioURL;
    status.textContent = `Estado: voz seleccionada -> ${item.name}`;

    if (Array.isArray(item.transcription) && item.transcription.length > 0) {
      baseTranscriptionSegments = item.transcription.map(seg =>
        buildWordTimingFromSegment(seg)
      );

      // IMPORTANTE:
      // aquí respetamos exactamente las líneas guardadas
      transcriptionSegments = baseTranscriptionSegments;

      renderKaraokeLyrics(transcriptionSegments);
      cargarLetrasEnMonitor();

      if (lyricsText) {
        lyricsText.value = transcriptionSegments
          .map(seg => seg.text || "")
          .join("\n")
          .trim();
      }

      status.textContent = "Estado: Voz seleccionada (Letras cargadas de memoria ⚡)";
    } else {
      baseTranscriptionSegments = [];
      transcriptionSegments = [];

      renderKaraokeLyrics([]);
      cargarLetrasEnMonitor();

      if (lyricsText) lyricsText.value = "";
      status.textContent = `Estado: voz seleccionada -> ${item.name} (sin transcripción guardada)`;
    }
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo cargar la voz seleccionada");
  }
}

// ==========================================
// TRANSCRIPCIÓN CON TÉCNICA DE CHUNKING
// ==========================================
async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) {
    alert("⚠️ Primero selecciona y carga una voz desde Biblioteca");
    return;
  }

  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  try {
    if (status) {
      status.textContent = "Estado: Preparando audio (cortando en porciones)...";
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await selectedVoiceBlob.arrayBuffer();
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

      if (status) {
        status.textContent = `Estado: Transcribiendo parte ${chunkNumber} de ${totalChunks}...`;
      }

      const wavBlob = audioBufferToWav(audioBuffer, start, end);
      const base64Audio = await blobToBase64(wavBlob);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64Audio })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      const palabrasProhibidas = [
        "Amara",
        "Subtítulos",
        "subtítulos",
        "Almorzo",
        "Suscribete",
        "comunidad"
      ];

      const timeOffset = start / sampleRate;

      (result.segments || []).forEach((seg) => {
        const segText = (seg?.text || "").trim();

        if (!segText) return;

        const esFantasma = palabrasProhibidas.some((palabra) =>
          segText.toLowerCase().includes(palabra.toLowerCase())
        );

        if (esFantasma) return;

        const segmentWithOffset = {
          start: Number(seg.start || 0) + timeOffset,
          end: Number(seg.end || 0) + timeOffset,
          text: segText
        };

        fullSegments.push(buildWordTimingFromSegment(segmentWithOffset));
      });
    }

    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);

    renderKaraokeLyrics(transcriptionSegments);
    cargarLetrasEnMonitor();

    if (lyricsText) {
      lyricsText.value = transcriptionSegments.map(line => line.text).join("\n");
    }

    // --- NUEVO: GUARDADO AUTOMÁTICO DEL ARCHIVO ULTRASTAR TXT ---
    try {
      const vozOriginal = await getLibraryItemById(selectedVoiceId); 
      const nombreBase = vozOriginal ? vozOriginal.name.replace(/🎙️ Voz - |Voz - /g, "") : "Nueva Canción";
      
      const cabeceraUltraStar = `#TITLE:${nombreBase}\n#ARTIST:Whisper Transcribe\n#BPM:120\n#GAP:0\n`;
      
      const cuerpoTexto = transcriptionSegments.map(line => {
        return line.text; 
      }).join("\n");

      const contenidoFinalTxt = cabeceraUltraStar + cuerpoTexto;

      await addLibraryItem({
        name: `UltraStar - ${nombreBase}`,
        type: "ultrastar_txt", 
        audioBlob: null,       
        textoPlano: contenidoFinalTxt, 
        date: new Date().toLocaleString("es-ES"),
        transcription: baseTranscriptionSegments 
      });

      console.log("✅ Nuevo archivo de Texto UltraStar creado en la Biblioteca");
      await renderLibrary("ultrastar_txt");

    } catch (err) {
      console.error("❌ Error al generar el archivo UltraStar independiente:", err);
    }

    // --- ACTUALIZACIÓN ORIGINAL DE LA VOZ VINCULADA ---
    if (selectedVoiceId) {
      try {
        await updateLibraryItem(selectedVoiceId, {
          transcription: baseTranscriptionSegments 
        });
        console.log("✅ Transcripción vinculada a la voz original");
      } catch (err) {
        console.error("❌ Error guardando transcripción en la voz:", err);
      }
    }

    if (status) {
      status.textContent = "Estado: Transcripción completada y guardada en texto ✅";
    }

  } catch (error) {
    console.error(error);
    alert("❌ Error al transcribir el audio.");
    if (status) status.textContent = "Estado: Error en la transcripción";
  }
}

async function guardarTextoUltraStarEnBiblioteca() {
  try {
    // 1. Obtén el texto limpio del mini monitor (ajusta el ID según tu HTML)
    const textoMonitor = document.getElementById("miniMonitorTextArea").value; 
    
    if (!textoMonitor.trim()) {
      alert("⚠️ El monitor está vacío. No hay texto para guardar.");
      return;
    }

    // 2. Extraer metadatos básicos para el nombre (puedes usar variables globales de tu app)
    const tituloCancion = window.currentSongTitle || "Nueva Canción";
    const artistaCancion = window.currentSongArtist || "Artista Desconocido";

    // 3. Crear el objeto con el nuevo tipo especializado
    const nuevoElemento = {
      name: `UltraStar - ${tituloCancion} (${artistaCancion})`,
      type: "ultrastar_txt", // <--- Este es el nuevo tipo de archivo para el filtro
      audioBlob: null,       // No requiere audio directo
      date: new Date().toLocaleString("es-ES"),
      textoPlano: textoMonitor, // Guardamos el formato de texto plano estructurado
      metadata: {
        title: tituloCancion,
        artist: artistaCancion,
        generadoPor: "Whisper + Manual Tap"
      }
    };

    // 4. Guardar en tu base de datos existente
    await addLibraryItem(nuevoElemento);

    // 5. Refrescar la vista actual de la biblioteca
    await renderLibrary("ultrastar_txt");
    
    alert("✅ ¡Texto UltraStar guardado en la biblioteca con éxito!");

  } catch (error) {
    console.error("Error al guardar texto UltraStar:", error);
    alert("❌ No se pudo guardar el archivo en la biblioteca.");
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
  const lines = document.querySelectorAll(".karaoke-line");
  if (!lines.length) return;

  let activeLine = null;

  lines.forEach((line) => {
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    line.classList.remove("active", "past", "upcoming");

    if (currentTime >= start && currentTime <= end) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end) {
      line.classList.add("past");
    } else {
      line.classList.add("upcoming");
    }

    const words = line.querySelectorAll(".karaoke-word");
    words.forEach((word) => {
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

  if (activeLine && autoScrollEnabled) {
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
  if (!track || !track.src) { alert("⚠️ Primero sube una pista instrumental."); return; }

  try {
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    // 1. LIMPIEZA ABSOLUTA DE HARDWARE ANTES DE EMPEZAR
    // Si había flujos abiertos del Afinador o Estudio, los apagamos para liberar los canales
    if (window.karaokeStream && typeof window.karaokeStream.getTracks === 'function') {
        window.karaokeStream.getTracks().forEach(t => t.stop());
    }
    if (window.karaokeStream2 && typeof window.karaokeStream2.getTracks === 'function') {
        window.karaokeStream2.getTracks().forEach(t => t.stop());
    }

    karaokeChunks = [];
    karaokeRecordedBlob = null;
    karaokeDuoAnalyser1 = null; 
    karaokeDuoAnalyser2 = null; 
    $("karaokeVoicePlayer").src = "";

    karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = karaokeDuoAudioContext.createMediaStreamDestination();

    const mic1Id = getSelectedMicId(1);
    const mic2Id = getSelectedMicId(2);

    const audioConstraints1 = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000
    };
    if (mic1Id) audioConstraints1.deviceId = { exact: mic1Id };

    // 🔥 CORRECCIÓN 1: Declaramos una constante local limpia (stream1) para aislar el hardware
    const stream1 = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints1 });
    window.karaokeStream = stream1; // Guardamos la referencia global para detenerlo después si es necesario

    // Procesar Mic 1 de forma totalmente independiente
    const source1 = karaokeDuoAudioContext.createMediaStreamSource(stream1);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source1);

    // Control de volumen Mic 1
    const volNode1 = karaokeDuoAudioContext.createGain();
    const sliderVol1 = $("mic1Volume"); 
    volNode1.gain.value = sliderVol1 ? parseFloat(sliderVol1.value) : 1.0;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; 

    // Inicializamos el analizador de Pitch del Mic 1 en 2048 para máxima fidelidad
    karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
    karaokeDuoAnalyser1.fftSize = 2048;
    volNode1.connect(karaokeDuoAnalyser1);

    const merger = karaokeDuoAudioContext.createChannelMerger(2);
    volNode1.connect(merger, 0, 0);

    if (!isDuo) {
      volNode1.connect(merger, 0, 1);
    }
    
    if (isDuo && mic2Id) {
      const audioConstraints2 = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
        deviceId: { exact: mic2Id }
      };

      const stream2 = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints2 });
      window.karaokeStream2 = stream2;

      const source2 = karaokeDuoAudioContext.createMediaStreamSource(stream2);
      const mic2Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source2);

      // === PREAMPLIFICADOR DIGITAL AUTOMÁTICO PARA MIC 2 ===
      const volNode2 = karaokeDuoAudioContext.createGain();
      
      // 🔥 SOLUCIÓN DEFINITIVA: Como no hay sliders en la app, 
      // forzamos un multiplicador automático de x3.0 a la señal.
      // Esto rescata el volumen bajo sin importar cómo esté configurado Windows.
      volNode2.gain.value = 3.0; 
      
      mic2Filtrado.connect(volNode2);
      currentVolNode2 = volNode2; 

      // Conexión al analizador de Pitch
      karaokeDuoAnalyser2 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser2.fftSize = 2048;
      volNode2.connect(karaokeDuoAnalyser2);

      // Enrutamos al mezclador final
      volNode2.connect(merger, 0, 1);

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) duoIndicator.style.display = "block";
    }

    merger.connect(destination);
    let finalStream = destination.stream;

    startKaraokeDuoLevelMonitor();

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    karaokeMediaRecorder = new MediaRecorder(finalStream, options);

    karaokeMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) karaokeChunks.push(e.data);
    };

    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      $("karaokeVoicePlayer").src = URL.createObjectURL(karaokeRecordedBlob);
      $("karaokeStatus").textContent = "Estado: Grabación finalizada ✅";
      stopKaraokeDuoLevelMonitor();
    };

    karaokeMediaRecorder.start();
    track.currentTime = 0;
    track.play();

    // Le damos un margen sutil de estabilidad antes de arrancar el motor de dibujo
    setTimeout(() => {
        startKaraokePitchDetection();
    }, 300);

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
    alert("❌ Error al acceder al micrófono.");
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
  
  // ¡AQUÍ AGREGA ESTAS DOS LÍNEAS!
  pitchHistoryMic1 = [];
  pitchHistoryMic2 = [];
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
  const sensInput = $("micSensitivity");
  if (sensInput) {
    
    sensInput.value = localStorage.getItem("singIt_sensitivity") || "0.015";
    
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("singIt_sensitivity", e.target.value);
    });
  }

  const settings = {
    micCount: "singIt_micCount",
    karaokeThemeSelect: "singIt_stage",
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
        
        // ¡AGREGA ESTE NUEVO BLOQUE AQUÍ PARA LOS ESCENARIOS!
        if (id === "karaokeThemeSelect") {
          const contenedorKaraoke = document.querySelector(".karaoke-lyrics");
          if (contenedorKaraoke) {
            // Limpiamos cualquier escenario anterior
            const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-cyberpunk"];
            todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
            
            // Aplicamos el nuevo escenario elegido
            contenedorKaraoke.classList.add(e.target.value);
          }
        }
      });
    }
    // Aplicar tema guardado al iniciar
    
    applyAppTheme(localStorage.getItem("singIt_theme") || "oscuro");
    const savedStage = localStorage.getItem("singIt_stage") || "theme-clasico";
    const contenedorKaraoke = document.querySelector(".karaoke-lyrics");
    if (contenedorKaraoke) {
      contenedorKaraoke.classList.add(savedStage);
    }
  });
}

function applyAppTheme(theme) {
  // Aplicamos el tema al elemento raíz (html)
  document.documentElement.setAttribute("data-theme", theme);
  
  // También al body por si acaso
  document.body.setAttribute("data-theme", theme);
  
  console.log("🎨 Tema aplicado:", theme);
}

// ==========================================
// GESTIÓN DE MICRÓFONOS
// ==========================================
let micTestStream = null;
let micTestAnalyser = null;
let micTestAnimationId = null;

async function loadAvailableMics() {
  try {
    // Primero pedimos permiso para acceder al micrófono
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Luego obtenemos la lista de dispositivos
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");

    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");

    if (mic1Select) {
      mic1Select.innerHTML = "";
      if (mics.length === 0) {
        mic1Select.innerHTML = `<option value="">No se detectaron micrófonos</option>`;
      } else {
        mics.forEach((mic, index) => {
          const option = document.createElement("option");
          option.value = mic.deviceId;
          option.textContent = mic.label || `Micrófono ${index + 1}`;
          mic1Select.appendChild(option);
        });
      }

      // Cargar selección guardada
      const savedMic1 = localStorage.getItem("singIt_mic1");
      if (savedMic1) mic1Select.value = savedMic1;
    }

    if (mic2Select) {
      mic2Select.innerHTML = "";
      if (mics.length === 0) {
        mic2Select.innerHTML = `<option value="">No se detectaron micrófonos</option>`;
      } else {
        mics.forEach((mic, index) => {
          const option = document.createElement("option");
          option.value = mic.deviceId;
          option.textContent = mic.label || `Micrófono ${index + 1}`;
          mic2Select.appendChild(option);
        });
      }

      // Cargar selección guardada
      const savedMic2 = localStorage.getItem("singIt_mic2");
      if (savedMic2) mic2Select.value = savedMic2;
    }

    console.log("🎙️ Micrófonos detectados:", mics.length);
  } catch (error) {
    console.error("Error al cargar micrófonos:", error);
    
    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");
    
    if (mic1Select) {
      mic1Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
    }
    if (mic2Select) {
      mic2Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
    }
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

async function testMicrophone(micNumber) {
  // Detener cualquier prueba anterior
  stopMicTest();

  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const levelId = micNumber === 1 ? "mic1Level" : "mic2Level";

  const select = $(selectId);
  const levelBar = $(levelId);

  if (!select || !levelBar) return;

  const deviceId = select.value;
  if (!deviceId) {
    alert("⚠️ Selecciona un micrófono primero");
    return;
  }

  try {
    const constraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micTestStream);
    micTestAnalyser = audioCtx.createAnalyser();
    micTestAnalyser.fftSize = 256;
    source.connect(micTestAnalyser);

    const levelFill = levelBar.querySelector(".mic-level-fill");
    if (levelFill) {
      levelFill.classList.add("active");
    }

    function updateLevel() {
      if (!micTestAnalyser) return;

      const dataArray = new Uint8Array(micTestAnalyser.frequencyBinCount);
      micTestAnalyser.getByteFrequencyData(dataArray);

      // Calcular volumen promedio
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const percentage = Math.min(100, (average / 128) * 100);

      if (levelFill) {
        levelFill.style.width = percentage + "%";
      }

      micTestAnimationId = requestAnimationFrame(updateLevel);
    }

    updateLevel();

    // Detener automáticamente después de 5 segundos
    setTimeout(() => {
      stopMicTest();
    }, 5000);

  } catch (error) {
    console.error("Error al probar micrófono:", error);
    alert("❌ No se pudo acceder al micrófono seleccionado");
  }
}

function stopMicTest() {
  if (micTestAnimationId) {
    cancelAnimationFrame(micTestAnimationId);
    micTestAnimationId = null;
  }

  if (micTestStream) {
    micTestStream.getTracks().forEach(track => track.stop());
    micTestStream = null;
  }

  micTestAnalyser = null;

  // Resetear barras de nivel
  const fills = document.querySelectorAll(".mic-level-fill");
  fills.forEach(fill => {
    fill.style.width = "0%";
    fill.classList.remove("active");
  });
}

function saveMicSelection(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const storageKey = micNumber === 1 ? "singIt_mic1" : "singIt_mic2";

  const select = $(selectId);
  if (select) {
    localStorage.setItem(storageKey, select.value);
    showSaveNotification();
  }
}

// Función helper para obtener el deviceId del mic seleccionado
function getSelectedMicId(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const select = $(selectId);
  return select ? select.value : null;
}

function showSaveNotification() {
  const notif = $("saveNotification");
  if (!notif) return;

  notif.classList.add("show");

  setTimeout(() => {
    notif.classList.remove("show");
  }, 2000);
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
  
  // Reproducir la PISTA desde el inicio (la sincronización es contra el instrumental)
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
    if (studioSelectedTrackBlob) {
        try {
            await addLibraryItem({
                name: `Karaoke - ${studioSelectedTrackName || "Sin título"}`,
                type: "karaoke",
                audioBlob: studioSelectedTrackBlob,
                date: new Date().toLocaleString("es-ES"),
                transcription: analyzedSegments,
                metadata: {
                    title: studioSelectedTrackName || "Sin título",
                    sourceVoiceId: selectedVoiceId || null,
                    sourceTrackId: studioSelectedTrackId || null
                }
            });
            console.log("✅ Canción karaoke creada");
        } catch (err) {
            console.error("❌ Error creando karaoke:", err);
        }
    } else {
        console.warn("⚠️ No hay pista instrumental seleccionada para crear karaoke");
    }
    
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

// ==========================================
// INIT
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const encabezados = document.querySelectorAll('.encabezado-desplegable');
  
  encabezados.forEach(encabezado => {
    encabezado.addEventListener('click', () => {
      // 2. Obtiene los IDs correspondientes a esta tarjeta específica
      const targetId = encabezado.getAttribute('data-target');
      const arrowId = encabezado.getAttribute('data-arrow');
      
      const content = document.getElementById(targetId);
      const arrow = document.getElementById(arrowId);
      
      // 3. Aplica los cambios si los elementos existen en la página
      if (content && arrow) {
        content.classList.toggle('oculto'); 
        arrow.classList.toggle('rotada');
      }
    });
  });
  try {
    await initDB();
    initSettings();

    function applyKaraokeTheme() {
      const theme = localStorage.getItem("singIt_stage") || "clasico";
      const monitor = $("karaokeLiveLyrics");
      if (monitor) {
        monitor.className = "karaoke-lyrics theme-" + theme;
      }
    }

    applyKaraokeTheme();

    safeAdd("karaokeThemeSelect", "change", (e) => {
      saveSetting("singIt_stage", e.target);
      applyKaraokeTheme();
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
      

    safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
      await loadKaraokeCatalog();
      await loadMyKaraokeSongs();
    });
      
    // Cargar catálogo y mis canciones al iniciar
    loadKaraokeCatalog();
    loadMyKaraokeSongs();
    
    // biblioteca - subir archivo desde PC
    safeAdd("saveLibraryFileBtn", "click", saveManualFileToLibrary);
    safeAdd("libraryFileInput", "change", (e) => {
      const file = e.target.files[0];
      const nameInput = $("libraryFileName");
      if (file && nameInput && !nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.[^.]+$/, "");
      }
    });

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
    await renderLibrary('todos');
    await loadTrackOptionsInStudio();
    await loadTrackOptionsInKaraoke();

    const player = $("player");
    if (player) {
      player.addEventListener("timeupdate", () => {
        updateKaraokeHighlight(player.currentTime);
      });

      player.addEventListener("ended", () => {
        updateKaraokeHighlight(player.currentTime);
      });
    }
  } catch (error) {
    console.error(error);
    alert("❌ Error inicializando la app");
  }
});

// ==========================================
// MONITOR DE KARAOKE (CANVAS)
// ==========================================

// --- FUNCIÓN PARA CONSTRUIR LA FRASE CON ESPACIOS DESDE LAS PALABRAS ---
function reconstruirFraseDesdeWords(segmento) {
  // 1. Si el segmento no existe, devolvemos vacío
  if (!segmento) return "";

  // 2. Intentar buscar el arreglo de palabras (revisamos .words y .text como plan B)
  const listaPalabras = Array.isArray(segmento.words) ? segmento.words : [];
  
  // 3. PLAN B AUTOMÁTICO: Si .words está vacío, pero el segmento ya tiene un texto plano general
  if (listaPalabras.length === 0 && segmento.text) {
    return segmento.text.trim(); 
  }

  // 4. Si encontramos palabras individuales, las unimos asegurando mapear la propiedad correcta
  return listaPalabras
    .map(w => {
      // Extraemos el texto buscando cualquier propiedad común (.text, .word o el objeto directo)
      let textoPalabra = "";
      if (typeof w === "string") textoPalabra = w;
      else if (w) textoPalabra = w.text || w.word || "";
      
      // Limpiamos los guiones de separación
      return textoPalabra.replace(/-/g, "");
    }) 
    .join(" ")            // Agrega los espacios automáticos que querías
    .replace(/\s+/g, " ") // Limpia espacios duplicados
    .trim();
}

// Mapeo para el Usuario 1 (Mitad Superior del Canvas)
function midiToY1(midiNote, height) {
  const minMidi = 50; // Nota base ajustable
  const maxMidi = 80; // Nota techo ajustable
  const mitadSuperior = height / 2;
  
  // Escala la nota para que viva únicamente entre el píxel 0 y la mitad del alto
  const pct = (midiNote - minMidi) / (maxMidi - minMidi);
  return mitadSuperior - (pct * mitadSuperior * 0.8) - (mitadSuperior * 0.1);
}

// Mapeo para el Usuario 2 (Mitad Inferior del Canvas)
function midiToY2(midiNote, height) {
    // Reducimos ligeramente el rango MIDI base para dar mayor margen vertical
    const minMidi = 40; // Bajamos el piso a 40 para capturar tonos graves amplificados
    const maxMidi = 80; 
    
    const mitadInferior = height / 2;
    
    // Calculamos el porcentaje de la nota dentro del rango
    let pct = (midiNote - minMidi) / (maxMidi - minMidi);
    
    // Limitamos el porcentaje entre 0 y 1 para que NUNCA se salga del canvas
    pct = Math.max(0, Math.min(1, pct));
    
    // Centramos la señal comprimiendo su escala al 70% del espacio del carril
    const yLocal = mitadInferior - (pct * mitadInferior * 0.7) - (mitadInferior * 0.15);
    
    // Desfasamos el resultado final para que empiece exactamente a la mitad del alto
    return yLocal + mitadInferior;
}

// ==========================================
// MONITOR DE KARAOKE (CANVAS-DRAW)
// ==========================================

function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const width = canvas.width;
  const height = canvas.height;

  // 1. GUARDAR HISTORIAL SEPARADO - MICRÓFONO 1
  pitchHistoryMic1.push(currentFreq > 0 ? currentFreq : null);
  if (pitchHistoryMic1.length > 60) pitchHistoryMic1.shift();

  // 2. GUARDAR HISTORIAL SEPARADO - MICRÓFONO 2
  pitchHistoryMic2.push(currentFreq2 > 0 ? currentFreq2 : null);
  if (pitchHistoryMic2.length > 60) pitchHistoryMic2.shift();

  // ========================================================
  // 🎨 CONFIGURACIÓN DE COLORES DINÁMICOS SEGÚN EL TEMA
  // ========================================================
  const temaActual = localStorage.getItem("singIt_karaoke_theme") || "theme-clasico";
  
  let colorFondo = "#111827";       // Fondo por defecto (Clásico)
  let colorLineas = "#333333";      // Líneas del pentagrama
  let colorEtiquetas = "#666666";   // Textos A4, G4, F4...
  let colorBarraFutura = "#1e40af"; // Azul estándar para notas futuras
  let colorBordeFuturo = "#3b82f6";

  if (temaActual === "theme-moderno") {
    colorFondo = "#082f49";         // Azul profundo neón
    colorLineas = "rgba(6, 182, 212, 0.2)";
    colorEtiquetas = "#06b6d4";
    colorBarraFutura = "#1e3a8a";
    colorBordeFuturo = "#06b6d4";
  } else if (temaActual === "theme-disco") {
    colorFondo = "#2e1065";         // Morado Disco / Fiesta
    colorLineas = "rgba(219, 39, 119, 0.25)";
    colorEtiquetas = "#facc15";
    colorBarraFutura = "#701a75";
    colorBordeFuturo = "#db2777";
  } else if (temaActual === "theme-acustico") {
    colorFondo = "#451a03";         // Madera cálida
    colorLineas = "rgba(120, 53, 15, 0.4)";
    colorEtiquetas = "#fcd34d";
    colorBarraFutura = "#78350f";
    colorBordeFuturo = "#b45309";
  } else if (temaActual === "theme-fiesta") {
    const hue = (Date.now() / 20) % 360;
    colorFondo = `hsl(${hue}, 40%, 12%)`;
    colorLineas = "rgba(255, 255, 255, 0.15)";
    colorEtiquetas = "#ff007f";
  } else if (temaActual === "theme-retrowave") {
    colorFondo = "#0b001a";         // Sincronía opcional con tu nuevo tema cyberpunk
    colorLineas = "rgba(255, 0, 128, 0.15)";
    colorEtiquetas = "#ff007f";
    colorBarraFutura = "#4c0519";
    colorBordeFuturo = "#ff007f";
  }

  // 🎯 PINTAMOS EL FONDO DEL TEMA
  ctx.fillStyle = colorFondo;
  ctx.fillRect(0, 0, width, height);

  // ====================================================================
  // 📏 --- RENDERING ESTRUCTURAL: PENTAGRAMAS DOBLES Y ADAPTACIÓN ---
  // ====================================================================
  const numLines = 5; // Ajustado a 5 líneas por cada mitad para no sobrecargar visualmente
  ctx.strokeStyle = colorLineas;
  ctx.lineWidth = 1.5;

  // Pentagrama 1 - Mitad Superior (Usuario 1)
  for (let i = 0; i <= numLines; i++) {
    const y = (height / 2) * 0.15 + ((height / 2) * 0.7 / numLines) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  // Pentagrama 2 - Mitad Inferior (Usuario 2)
  for (let i = 0; i <= numLines; i++) {
    const y = (height / 2) + (height / 2) * 0.15 + ((height / 2) * 0.7 / numLines) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  // --- INDICADORES DE NOTAS IZQUIERDA (Duplicados por panel) ---
  ctx.fillStyle = colorEtiquetas;
  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  const noteLabelsSuperior = ["A4", "G4", "F4", "E4", "D4", "C4"];
  const noteLabelsInferior = ["B3", "A3", "G3", "F3", "E3", "D3"];

  noteLabelsSuperior.forEach((label, i) => {
    const y = (height / 2) * 0.15 + ((height / 2) * 0.7 / numLines) * i + 4;
    ctx.fillText(label, 25, y);
  });

  noteLabelsInferior.forEach((label, i) => {
    const y = (height / 2) + (height / 2) * 0.15 + ((height / 2) * 0.7 / numLines) * i + 4;
    ctx.fillText(label, 25, y);
  });

  // ====================================================================
  // 🎵 --- DIBUJAR BARRAS DE NOTAS DE LA CANCIÓN (BIFOCAL) ---
  // ====================================================================
  if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
    const timeWindowStart = currentTime - 1;
    const timeWindowEnd = currentTime + 5;
    const pixelsPerSecond = (width - 40) / 6;
    const lineX = 40;

    // Dibujar líneas de tiempo actual independientes (Arriba y Abajo)
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    
    ctx.beginPath(); ctx.moveTo(lineX, 0); ctx.lineTo(lineX, height / 2); ctx.stroke(); // Línea lectora 1
    ctx.beginPath(); ctx.moveTo(lineX, height / 2); ctx.lineTo(lineX, height); ctx.stroke(); // Línea lectora 2

    transcriptionSegments.forEach((segment) => {
      const words = Array.isArray(segment.words) ? segment.words : [];
      words.forEach((word) => {
        if (word.end < timeWindowStart || word.start > timeWindowEnd) return;
        
        const wordStartX = lineX + (word.start - currentTime) * pixelsPerSecond;
        const wordEndX = lineX + (word.end - currentTime) * pixelsPerSecond;
        const barWidth = Math.max(wordEndX - wordStartX, 30);
        
        const midi = word.midi || segment.midi || 60;
        const barHeight = 18; // Ligeramente más compacta para caber en las mitades
        
        const isActive = currentTime >= word.start && currentTime <= word.end;
        const isPast = currentTime > word.end;
        
        // Detección estricta de aciertos por canal
        let isCorrectMic1 = false;
        let isCorrectMic2 = false;
        
        if (isActive) {
          if (currentFreq > 0 && Math.abs(frequencyToMidi(currentFreq) - midi) <= 2) isCorrectMic1 = true;
          if (currentFreq2 > 0 && Math.abs(frequencyToMidi(currentFreq2) - midi) <= 2) isCorrectMic2 = true;
        }
        
        // --- PROCESAR E INYECTAR EN PANEL 1 (ARRIBA - USUARIO 1) ---
        let barColor1, textColor1, borderColor1;
        if (isPast) {
          barColor1 = "#4b5563"; textColor1 = "#9ca3af"; borderColor1 = "#6b7280";
        } else if (isActive) {
          if (isCorrectMic1) {
            barColor1 = "#22c55e"; textColor1 = "#ffffff"; borderColor1 = "#4ade80";
          } else {
            barColor1 = "#3b82f6"; textColor1 = "#ffffff"; borderColor1 = "#60a5fa";
          }
        } else {
          barColor1 = colorBarraFutura; textColor1 = "#93c5fd"; borderColor1 = colorBordeFuturo;
        }

        const barY1 = midiToY1(midi, height);
        ctx.fillStyle = barColor1;
        ctx.strokeStyle = borderColor1;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(wordStartX, barY1 - barHeight/2, barWidth, barHeight, 6);
        ctx.fill(); ctx.stroke();
        
        ctx.fillStyle = textColor1;
        ctx.font = isActive ? "bold 12px Arial" : "11px Arial";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        let displayWord = word.word || "";
        if (displayWord.length > 10) displayWord = displayWord.substring(0, 8) + "..";
        ctx.fillText(displayWord, wordStartX + barWidth/2, barY1);

        // ====================================================================
        // --- PROCESAR E INYECTAR EN PANEL 2 (ABAJO - JUGADOR 2) ---
        // ====================================================================
        let barColor2, textColor2, borderColor2;
        if (isPast) {
          barColor2 = "#4b5563"; textColor2 = "#9ca3af"; borderColor2 = "#6b7280";
        } else if (isActive) {
          if (isCorrectMic2) {
            barColor2 = "#22c55e"; textColor2 = "#ffffff"; borderColor2 = "#4ade80";
          } else {
            barColor2 = "#3b82f6"; textColor2 = "#ffffff"; borderColor2 = "#60a5fa";
          }
        } else {
          barColor2 = colorBarraFutura; textColor2 = "#93c5fd"; borderColor2 = colorBordeFuturo;
        }

        const barY2 = midiToY2(midi, height);
        ctx.fillStyle = barColor2;
        ctx.strokeStyle = borderColor2;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.beginPath();
        ctx.roundRect(wordStartX, barY2 - barHeight/2, barWidth, barHeight, 6);
        ctx.fill(); 
        ctx.stroke();

        // 🎯 CORRECCIÓN: Configuración y dibujado de la letra para el Jugador 2
        ctx.fillStyle = textColor2;
        ctx.font = isActive ? "bold 12px Arial" : "11px Arial";
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle";
        
        let displayWord2 = word.word || "";
        if (displayWord2.length > 10) displayWord2 = displayWord2.substring(0, 8) + "..";
        
        // Aquí se pinta físicamente la palabra abajo
        ctx.fillText(displayWord2, wordStartX + barWidth/2, barY2); 
      });
    });
    
  } else {
    ctx.fillStyle = "#666";
    ctx.font = "15px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas", width / 2, height / 2 - 40);
    ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas", width / 2, height / 2 + 40);
  }

  // ====================================================================
  // ⚡ --- CAPA INTERMEDIA: LÍNEA DIVISORIA ELECTRÓNICA ---
  // ====================================================================
  ctx.beginPath();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.3)"; 
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]); 
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.setLineDash([]); 

  // ====================================================================
  // 🎙️ --- MONITOR CANAL 1 ACTUAL: JUGADOR 1 (ARRIBA - AMARILLO) ---
  // ====================================================================
  ctx.beginPath();
  ctx.strokeStyle = "rgba(250, 204, 21, 0.65)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  let started1 = false;
  
  pitchHistoryMic1.forEach((freq, i) => {
    if (freq && freq > 0) {
      const y = midiToY1(frequencyToMidi(freq), height);
      const x = 40 - (pitchHistoryMic1.length - i) * 3; 
      
      if (x >= 0) {
        if (!started1) { ctx.moveTo(x, y); started1 = true; } 
        else { ctx.lineTo(x, y); }
      }
    } else { started1 = false; }
  });
  ctx.stroke();

  if (currentFreq && currentFreq > 0) {
    const userY1 = midiToY1(frequencyToMidi(currentFreq), height);
    ctx.beginPath();
    ctx.fillStyle = "#facc15";
    ctx.shadowBlur = 15; ctx.shadowColor = "#facc15";
    ctx.arc(40, userY1, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // =======================================================
  // 🐬 --- MONITOR USUARIO 2 - ABAJO (CELESTE / CIAN) ---
  // =======================================================
  ctx.beginPath();
  ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
  ctx.lineWidth = 4;
  let started2 = false;
  
  pitchHistoryMic2.forEach((freq, i) => {
    if (freq && freq > 0) {
      // 🔥 CAMBIO: Usa midiToY2 para la mitad de abajo
      const y = midiToY2(frequencyToMidi(freq), height);
      const x = 40 - (pitchHistoryMic2.length - i) * 3; 
      
      if (x >= 0) {
        if (!started2) { ctx.moveTo(x, y); started2 = true; } 
        else { ctx.lineTo(x, y); }
      }
    } else { started2 = false; }
  });
  ctx.stroke();

  if (currentFreq2 && currentFreq2 > 0) {
    const userY2 = midiToY2(frequencyToMidi(currentFreq2), height);
    ctx.beginPath();
    ctx.fillStyle = "#06b6d4";
    ctx.shadowBlur = 15; ctx.shadowColor = "#06b6d4";
    ctx.arc(40, userY2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
  
// ==========================================
// DETECCIÓN DE PITCH PARA KARAOKE
// ==========================================
async function startKaraokePitchDetection() {
  function loop() {
    const track = $("karaokeTrack");
    const currentTime = track ? track.currentTime : 0;
    
    // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 1 (AMARILLO) ---
    
    let pitch1 = -1;
    if (karaokeDuoAnalyser1) {
      const buffer1 = new Float32Array(karaokeDuoAnalyser1.fftSize);
      karaokeDuoAnalyser1.getFloatTimeDomainData(buffer1);
      
      // 1. Calculamos el volumen real (RMS) de este buffer específico antes de analizar
      let sum1 = 0;
      for (let i = 0; i < buffer1.length; i++) { sum1 += buffer1[i] * buffer1[i]; }
      const rms1 = Math.sqrt(sum1 / buffer1.length);
      
      // 2. Filtro de confianza: Si el volumen es menor a 0.015, es ruido eléctrico de fondo.
      // Ignoramos el cálculo del pitch (-1) para evitar que la esfera se caiga al piso del canvas.
      if (rms1 > 0.015) {
        pitch1 = autoCorrelate(buffer1, karaokeDuoAudioContext?.sampleRate || 48000);
      } else {
        pitch1 = -1; 
      }
    }
    
    // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 2 (CELESTE) ---
    let pitch2 = -1; 
    if (karaokeDuoAnalyser2) {
      const buffer2 = new Float32Array(karaokeDuoAnalyser2.fftSize);
      karaokeDuoAnalyser2.getFloatTimeDomainData(buffer2);
      let sum2 = 0;
      for (let i = 0; i < buffer2.length; i++) { sum2 += buffer2[i] * buffer2[i]; }
      const rms2 = Math.sqrt(sum2 / buffer2.length);
      if (rms2 > 0.015) {
        pitch2 = autoCorrelate(buffer2, karaokeDuoAudioContext?.sampleRate || 48000);
      } else {
        pitch2 = -1;
      }
    }
    
    // ENVIAR AMBOS TONOS AL MONITOR VISUAL
    if (typeof drawKaraokeMonitor === 'function') {
      drawKaraokeMonitor(currentTime, pitch1, pitch2);
    }
    
    // Control del bucle de animación
    if (track && track.ended) return;
    if (karaokeMediaRecorder && karaokeMediaRecorder.state === "recording") {
      requestAnimationFrame(loop);
    }
  }
  loop();
}

function parseUltrastarTxt(content) {
  const lines = content.split("\n");
  const metadata = {};
  const notes = [];
  
  let currentBeat = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Metadatos (líneas que empiezan con #)
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }
    
    // Notas (líneas que empiezan con :, *, F, o -)
    if (trimmed.match(/^[:*F\-]/)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0]; // : = normal, * = golden, F = freestyle, - = line break
      
      if (type === "-") {
        // Line break - marca fin de línea
        continue;
      }
      
      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        const syllable = parts.slice(4).join(" ");
        
        notes.push({
          type: type,
          startBeat: startBeat,
          duration: duration,
          pitch: pitch, // Nota MIDI relativa
          syllable: syllable
        });
      }
    }
  }
  
  return {
    title: metadata.TITLE || "Sin título",
    artist: metadata.ARTIST || "Desconocido",
    bpm: parseFloat(metadata.BPM) || 120,
    gap: parseFloat(metadata.GAP) || 0, // Milisegundos antes de la primera nota
    videoGap: parseFloat(metadata.VIDEOGAP) || 0,
    genre: metadata.GENRE || "",
    language: metadata.LANGUAGE || "",
    year: metadata.YEAR || "",
    notes: notes
  };
}

function ultrastarToSegments(parsed) {
  if (!parsed || !parsed.notes || !parsed.notes.length) {
    return [];
  }
  
  const bpm = parsed.bpm;
  const gap = parsed.gap / 1000; // Convertir a segundos
  const beatDuration = 60 / bpm / 4; // Duración de un beat en segundos (UltraStar usa quarter beats)
  
  // Agrupar sílabas en líneas/palabras
  const segments = [];
  let currentSegment = null;
  let currentWords = [];
  let lastEndBeat = 0;
  
  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    const midiNote = 60 + note.pitch; // UltraStar usa pitch relativo, base = C4 (60)
    
    // Detectar si hay un salto grande (nueva línea)
    const gapFromLast = note.startBeat - lastEndBeat;
    
    if (gapFromLast > 8 && currentWords.length > 0) {
      // Guardar segmento anterior
      if (currentWords.length > 0) {
        segments.push({
          start: currentWords[0].start,
          end: currentWords[currentWords.length - 1].end,
          text: currentWords.map(w => w.word).join(""),
          words: currentWords,
          pitch: currentWords[0].pitch,
          midi: currentWords[0].midi,
          note: currentWords[0].note
        });
      }
      currentWords = [];
    }
    
    // Agregar palabra/sílaba
    currentWords.push({
      word: note.syllable,
      start: startTime,
      end: endTime,
      pitch: midiToFrequency(midiNote),
      midi: midiNote,
      note: getNoteFromFrequency(midiToFrequency(midiNote))
    });
    
    lastEndBeat = note.startBeat + note.duration;
  }
  
  // Agregar último segmento
  if (currentWords.length > 0) {
    segments.push({
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(""),
      words: currentWords,
      pitch: currentWords[0].pitch,
      midi: currentWords[0].midi,
      note: currentWords[0].note
    });
  }
  
  return segments;
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
        <p style="font-size: 13px;">Crea canciones en Estudio.</p>
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
      track.play().catch(e => console.error("Error al reproducir audio:", e));
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
    // Obtener canciones tipo "karaoke" de la biblioteca
    const karaokeSongs = await getLibraryItemsByType("karaoke");
    
    // También obtener voces que tengan transcripción
    const voces = await getLibraryItemsByType("voz");
    const vocesConSync = voces.filter(v => v.transcription && v.transcription.length > 0);
    
    const allSongs = [...karaokeSongs, ...vocesConSync];
    
    if (allSongs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>No tienes canciones listas aún.</p>
          <p style="font-size: 13px;">Sincroniza una en Estudio.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = "";
    
    allSongs.forEach(song => {
      const div = document.createElement("div");
      div.className = "my-karaoke-item";
      
      const title = song.metadata?.title || song.name || "Sin título";
      const artist = song.metadata?.artist || "";
      
      div.innerHTML = `
        <div class="my-karaoke-item-info">
          <p class="my-karaoke-item-title">${title}</p>
          <p class="my-karaoke-item-artist">${artist || "Artista desconocido"}</p>
        </div>
        <div class="my-karaoke-item-actions">
          <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #22c55e;">▶️ Cantar</button>
          <button type="button" class="share-karaoke-btn" data-id="${song.id}" style="background: #8b5cf6; padding: 8px 10px;" title="Compartir como .singit">📤</button>
          <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 8px 10px;">🗑️</button>
        </div>
      `;
      
      container.appendChild(div);
    });
    
    // Agregar eventos
    container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => loadKaraokeSong(Number(btn.dataset.id)));
    });
    
    container.querySelectorAll(".share-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => exportKaraokeSong(Number(btn.dataset.id)));
    });

    container.querySelectorAll(".delete-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Eliminar esta canción de tu biblioteca?")) {
          await deleteLibraryItemFromDB(Number(btn.dataset.id));
          await loadMyKaraokeSongs();
        }
      });
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

// ==========================================
// COMPARTIR / IMPORTAR KARAOKES (.singit)
// ==========================================
function blobToBase64Full(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data:audio/...;base64,xxxx
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*?);base64/) || [, "audio/mpeg"])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportKaraokeSong(id) {
  try {
    const item = await getLibraryItemById(id);
    if (!item) {
      alert("⚠️ No se encontró el karaoke");
      return;
    }
    const payload = {
      app: "SingIt",
      version: 1,
      exportedAt: new Date().toISOString(),
      name: item.name,
      type: item.type,
      metadata: item.metadata || {},
      transcription: item.transcription || [],
      audio: item.audioBlob ? await blobToBase64Full(item.audioBlob) : null,
      vocals: item.vocalsBlob ? await blobToBase64Full(item.vocalsBlob) : null
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const safeName = (item.name || "karaoke").replace(/[^a-zA-Z0-9-_]+/g, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.singit`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    console.log("✅ Karaoke exportado:", safeName);
  } catch (err) {
    console.error("❌ Error exportando:", err);
    alert("❌ Error al exportar el karaoke");
  }
}

async function importKaraokeFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.app !== "SingIt") {
      alert("⚠️ Archivo no válido (no es un .singit)");
      return;
    }
    const audioBlob = data.audio ? dataUrlToBlob(data.audio) : null;
    const vocalsBlob = data.vocals ? dataUrlToBlob(data.vocals) : null;
    if (!audioBlob) {
      alert("⚠️ El archivo no contiene audio");
      return;
    }
    await addLibraryItem({
      name: data.name || "Karaoke importado",
      type: "karaoke",
      audioBlob: audioBlob,
      vocalsBlob: vocalsBlob,
      date: new Date().toLocaleString("es-ES"),
      transcription: data.transcription || [],
      metadata: data.metadata || {}
    });
    await loadMyKaraokeSongs();
    await renderLibrary("todos");
    alert(`✅ "${data.name}" importado en la Biblioteca y en Karaoke → Mis Canciones`);
  } catch (err) {
    console.error("❌ Error importando .singit:", err);
    alert("❌ Archivo .singit inválido o corrupto");
  }
}

function cambiarEscenarioKaraoke() {
  const select = document.getElementById("karaokeThemeSelect");
  const contenedorKaraoke = document.getElementById("karaokeLyrics"); 
  
  if (!select || !contenedorKaraoke) return;

  const nuevoTema = select.value ? select.value.trim() : "";

  if (!nuevoTema) {
    return; 
  }

  // 🔥 AGREGADO: "theme-retrowave" al final de la lista
  const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];
  
  todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
  contenedorKaraoke.classList.add(nuevoTema);

  localStorage.setItem("singIt_karaoke_theme", nuevoTema);
  
  if (typeof showSaveNotification === "function") {
    showSaveNotification();
  }
}

// ==========================================
// ESCUCHAR CAMBIOS Y CARGAR AL INICIAR
// ==========================================
document.getElementById("karaokeThemeSelect")?.addEventListener("change", cambiarEscenarioKaraoke);

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("karaokeThemeSelect");
  if (!select) return;

  // Leemos la clave exclusiva del escenario
  let temaGuardado = localStorage.getItem("singIt_karaoke_theme");
  
  if (!temaGuardado || temaGuardado === "undefined") {
    temaGuardado = "theme-clasico";
  }

  select.value = temaGuardado; 
  cambiarEscenarioKaraoke();   
});
