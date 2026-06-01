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

function handleTap() {
    const elements = [document.getElementById('tapCurrentLine'), document.getElementById('tapProgress')];
    
    elements.forEach(el => {
        // Remove class to reset animation
        el.classList.remove('tap-active');
        // Trigger reflow to allow animation to restart
        void el.offsetWidth; 
        // Re-add class
        el.classList.add('tap-active');
    });
}

function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

let pitchHistoryMic1 = [];
let pitchHistoryMic2 = [];
let isPitchDetectionRunning = false;
let micTestAudioContext = null;
let micTestAnimationId = null;
let micTestStream = null;

// Variables globales para control de volumen de micrófonos
let currentVolNode1 = null;
let currentVolNode2 = null;

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
    karaokeLibrary: "btnKaraokeLibrary",
    karaoke: "btnKaraoke",
    splitter: "btnSplitter",
    config: "btnConfig"
  };

  const activeBtn = $(btnMap[tabId]);
  if (activeBtn) activeBtn.classList.add("active");
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

function aplicarCadenaDeAudio(audioCtx, source) {
 // Filtro Paso Alto (Elimina zumbidos graves de 80Hz hacia abajo)
 const highPass = audioCtx.createBiquadFilter();
 highPass.type = "highpass";
 highPass.frequency.value = 80;
 
 // Filtro Paso Bajo ESTRICTO (Solo sirve para detectar el Pitch matemático)
 const lowPass = audioCtx.createBiquadFilter();
 lowPass.type = "lowpass";
 lowPass.frequency.value = 1000; // <--- Corta el brillo vocal, ideal solo para afinador
 
 const gainNode = audioCtx.createGain();
 gainNode.gain.value = 1.5;
 
 source.connect(highPass);
 highPass.connect(lowPass);
 lowPass.connect(gainNode);
 
 return gainNode; 
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
    duoAnalyser1.fftSize = 2048;
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
      duoAnalyser2.fftSize = 2048;
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
// TRANSCRIPCIÓN CON TÉCNICA DE CHUNKING (CORREGIDA)
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

    // --- NUEVO: GUARDADO AUTOMÁTICO DEL ARCHIVO ULTRASTAR TXT CORREGIDO ---
    try {
      const vozOriginal = await getLibraryItemById(selectedVoiceId); 
      const nombreBase = vozOriginal ? vozOriginal.name.replace(/🎙️ Voz - |Voz - /g, "") : "Nueva Canción";
      
      const bpmPorDefecto = 120;
      const gapPorDefecto = 0;
      const duracionUnBeat = 60 / (bpmPorDefecto * 4); // Resolución x4 para evitar que se corra el tiempo

      const cabeceraUltraStar = `#TITLE:${nombreBase}\n#ARTIST:Whisper Transcribe\n#BPM:${bpmPorDefecto}\n#GAP:${gapPorDefecto}\n`;
      let lineasCuerpo = [];

      // Mapeamos los segmentos nativos de Whisper a líneas de tiempo estructuradas de UltraStar
      baseTranscriptionSegments.forEach((seg, index) => {
        // Convertimos segundos absolutos a Beats de la rejilla matemática musical
        const startBeat = Math.max(0, Math.floor(seg.start / duracionUnBeat));
        const endBeat = Math.max(startBeat + 1, Math.floor(seg.end / duracionUnBeat));
        const lengthBeats = endBeat - startBeat;
        
        // Pitch por defecto en 0 (Equivale a C4/Do Central) hasta que el usuario use los Taps o cante
        const pitchBase = 0; 
        
        // Asegurar que el texto conserve un espacio si no es una sílaba unida
        const textoLimpio = seg.text ? ` ${seg.text.trim()}` : " ...";

        lineasCuerpo.push(`: ${startBeat} ${lengthBeats} ${pitchBase}${textoLimpio}`);

        // Insertar un corte de línea reglamentario (-) si detectamos pausas naturales o signos de puntuación
        if (seg.text && (seg.text.includes("\n") || seg.text.includes(".") || seg.text.includes(","))) {
          lineasCuerpo.push("-");
        }
      });

      // Añadimos el cierre obligatorio del archivo "E"
      lineasCuerpo.push("E");

      const contenidoFinalTxt = cabeceraUltraStar + lineasCuerpo.join("\n");

      await addLibraryItem({
        name: `UltraStar - ${nombreBase}`,
        type: "ultrastar_txt", 
        audioBlob: null,       
        textoPlano: contenidoFinalTxt, 
        date: new Date().toLocaleString("es-ES"),
        transcription: baseTranscriptionSegments 
      });

      console.log("✅ Archivo estructurado de UltraStar TXT creado con éxito en la Biblioteca");
      await renderLibrary("ultrastar_txt");

    } catch (err) {
      console.error("❌ Error al generar el archivo UltraStar estructurado:", err);
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
    const textoMonitor = document.getElementById("miniMonitorTextArea").textContent || document.getElementById("miniMonitorTextArea").innerText; 
    
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

// ==========================================
// PROCESADOR DE TIEMPOS VINCULADO A TAPS (CORREGIDO)
// ==========================================
function buildWordTimingFromSegment(segment) {
  const cleanText = (segment.text || "").trim();

  if (!cleanText) {
    return {
      ...segment,
      words: []
    };
  }

  // Dividimos por palabras de forma limpia
  const rawWords = cleanText.split(/\s+/).filter(Boolean);
  const segmentDuration = Math.max(0, (segment.end || 0) - (segment.start || 0));

  if (!rawWords.length || segmentDuration <= 0) {
    return {
      ...segment,
      words: rawWords.map(word => ({
        word: word,
        start: segment.start,
        end: segment.end,
        pitch: segment.pitch || 0,
        note: segment.note || "C4"
      }))
    };
  }

  // Corrección de estabilidad: División equitativa base en fragmentos del segmento
  // Esto previene que palabras largas bloqueen la memoria del capturador de Taps
  const sliceDuration = segmentDuration / rawWords.length;
  let cursor = segment.start;

  const timedWords = rawWords.map((word, index) => {
    const wordStart = cursor;
    const wordEnd = cursor + sliceDuration;
    cursor = wordEnd;

    // Retornamos la estructura limpia nativa de tu app, lista para los Taps
    return {
      word: word,
      start: wordStart,
      end: wordEnd,
      pitch: segment.pitch || 0,
      note: segment.note || "C4",
      sincronizado: false // Flag auxiliar para que el grabador de taps sepa qué palabra sigue
    };
  });

  return {
    ...segment,
    words: timedWords
  };
}


// ==========================================
// ANÁLISIS DE PITCH OFFLINE REFORZADO (CORREGIDO)
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
    const channelData = audioBuffer.numberOfChannels > 0 ? audioBuffer.getChannelData(0) : new Float32Array(0);
    
    console.log("🎵 Analizando pitch de", segments.length, "segmentos...");

    const analyzedSegments = segments.map((segment, index) => {
      const startSample = Math.floor(segment.start * sampleRate);
      const endSample = Math.floor(segment.end * sampleRate);
      
      // Control de desbordamientos del buffer original
      const safeStart = Math.max(0, Math.min(startSample, channelData.length));
      const safeEnd = Math.max(safeStart, Math.min(endSample, channelData.length));
      const segmentSamples = channelData.slice(safeStart, safeEnd);
      
      const pitch = detectPitchFromSamples(segmentSamples, sampleRate);
      const note = pitch > 0 ? getNoteFromFrequency(pitch) : null;
      const midiNote = pitch > 0 ? frequencyToMidi(pitch) : null;
      
      let analyzedWords = [];
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        analyzedWords = segment.words.map(word => {
          const wordStartSample = Math.floor(word.start * sampleRate);
          const wordEndSample = Math.floor(word.end * sampleRate);
          
          const safeWordStart = Math.max(0, Math.min(wordStartSample, channelData.length));
          const safeWordEnd = Math.max(safeWordStart, Math.min(wordEndSample, channelData.length));
          const wordSamples = channelData.slice(safeWordStart, safeWordEnd);
          
          const wordPitch = detectPitchFromSamples(wordSamples, sampleRate);
          const wordNote = wordPitch > 0 ? getNoteFromFrequency(wordPitch) : note;
          const wordMidi = wordPitch > 0 ? frequencyToMidi(wordPitch) : midiNote;
          
          return {
            ...word,
            pitch: wordPitch > 0 ? wordPitch : (pitch > 0 ? pitch : 0),
            note: wordNote || "C4",
            midi: wordMidi || 60
          };
        });
      }

      return {
        ...segment,
        pitch: pitch > 0 ? pitch : 0,
        note: note || "C4",
        midi: midiNote || 60,
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
  if (!samples || samples.length < 64) return -1; // Descartar micro-ruidos inservibles
  
  // 1. Clonar y rellenar con ceros (Zero-Padding) si el arreglo es menor a 2048 muestras
  // Esto previene que las sílabas rápidas devuelvan siempre -1
  let buffer = new Float32Array(2048);
  if (samples.length < 2048) {
    buffer.set(samples, 0); // Copiamos el fragmento corto al inicio, el resto queda en 0
  } else {
    buffer = samples.slice(0, 2048);
  }

  const bufferSize = buffer.length;
  
  // 2. Calcular RMS de energía
  let rms = 0;
  for (let i = 0; i < bufferSize; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / bufferSize);
  if (rms < 0.01) return -1; 

  // 3. Center Clipping para limpiar el ruido consonante de las palabras
  let maxVal = -1;
  let minVal = 1;
  for (let i = 0; i < bufferSize; i++) {
    if (buffer[i] > maxVal) maxVal = buffer[i];
    if (buffer[i] < minVal) minVal = buffer[i];
  }
  const maxCenterClip = Math.max(Math.abs(maxVal), Math.abs(minVal)) * 0.25;
  
  const clippedBuffer = new Float32Array(bufferSize);
  for (let i = 0; i < bufferSize; i++) {
    if (Math.abs(buffer[i]) > maxCenterClip) {
      clippedBuffer[i] = buffer[i] > 0 ? buffer[i] - maxCenterClip : buffer[i] + maxCenterClip;
    }
  }

  // 4. Autocorrelación Matemática sobre los rangos vocales estables (C2 - C6)
  const maxPeriod = Math.floor(sampleRate / 65);
  const minPeriod = Math.floor(sampleRate / 1000);
  
  let bestOffset = -1;
  let bestCorrelation = 0;
  let r = new Float32Array(maxPeriod + 1);

  for (let offset = minPeriod; offset <= maxPeriod; offset++) {
    let correlation = 0;
    for (let i = 0; i < bufferSize - offset; i++) {
      correlation += clippedBuffer[i] * clippedBuffer[i + offset];
    }
    r[offset] = correlation;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation < 0.1 || bestOffset === -1) return -1;

  // 5. Interpolación Parabólica para fijar la nota exacta sin brincos visuales
  let refinedOffset = bestOffset;
  if (bestOffset > minPeriod && bestOffset < maxPeriod) {
    const alpha = r[bestOffset - 1];
    const beta = r[bestOffset];
    const gamma = r[bestOffset + 1];
    const denominator = 2 * (alpha - 2 * beta + gamma);
    if (denominator !== 0) {
      refinedOffset = bestOffset - (gamma - alpha) / denominator;
    }
  }

  const frequency = sampleRate / refinedOffset;
  if (frequency < 60 || frequency > 1100) return -1;

  return frequency;
}


function frequencyToMidi(freq) {
  if (freq <= 0) return 0;
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ==========================================
// RENDERIZADO GRÁFICO INTERACTIVO (CORREGIDO)
// ==========================================
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

  // CORRECCIÓN: En lugar de destruir los tiempos proporcionalmente,
  // mapeamos las palabras editadas preservando las marcas de tiempo del buffer original
  let palabraIndexGlobal = 0;
  const todasLasPalabrasBase = [];
  
  baseSegments.forEach(seg => {
    if (seg.words) todasLasPalabrasBase.push(...seg.words);
  });

  if (todasLasPalabrasBase.length === 0) {
    // Si no hay base previa, recurrimos a una aproximación temporal segura
    return aproximarTiemposPorDefecto(lines, baseSegments);
  }

  return lines.map((line) => {
    const rawWords = line.split(/\s+/).filter(Boolean);
    const timedWords = [];

    rawWords.forEach((word) => {
      // Intentamos emparejar con el tiempo real guardado por Whisper/Taps
      const baseWord = todasLasPalabrasBase[palabraIndexGlobal] || todasLasPalabrasBase[todasLasPalabrasBase.length - 1];
      
      timedWords.push({
        word: word,
        start: baseWord ? baseWord.start : 0,
        end: baseWord ? baseWord.end : 1,
        pitch: baseWord ? baseWord.pitch : 0,
        note: baseWord ? baseWord.note : "C4"
      });
      
      palabraIndexGlobal++;
    });

    return {
      start: timedWords.length ? timedWords[0].start : 0,
      end: timedWords.length ? timedWords[timedWords.length - 1].end : 0,
      text: line,
      words: timedWords
    };
  });
}

function aproximarTiemposPorDefecto(lines, baseSegments) {
  const totalStart = baseSegments[0].start;
  const totalEnd = baseSegments[baseSegments.length - 1].end;
  const totalDuration = Math.max(1, totalEnd - totalStart);
  const slice = totalDuration / lines.length;
  let cursor = totalStart;

  return lines.map((line) => {
    const seg = { start: cursor, end: cursor + slice, text: line };
    cursor += slice;
    return buildWordTimingFromSegment(seg);
  });
}

function renderKaraokeLyrics(segments) {
  const container = $("karaokeLyrics");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(segments) || !segments.length) {
    container.innerHTML = `<p class="karaoke-placeholder">No hay segmentos para mostrar.</p>`;
    return;
  }

  segments.forEach((segment, index) => {
    const line = document.createElement("p");
    line.className = "karaoke-line upcoming"; // Por defecto todas están en el futuro
    line.id = `k-line-${index}`; // ID único directo para acelerar la búsqueda
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

// NUEVA VARIABLE DE CONTROL CACHÉ PARA EVITAR LAG EN EL NAVEGADOR
let lineaActivaIndexCache = -1;

function updateKaraokeHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-line");
  if (!lines.length) return;

  let nuevoActiveLine = null;
  let nuevoActiveIndex = -1;

  // 1. Encontrar la línea activa basándonos en marcas de tiempo aproximadas
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    if (currentTime >= start && currentTime <= end) {
      nuevoActiveLine = line;
      nuevoActiveIndex = i;
      break;
    }
  }

  // 2. Solo mutamos las clases globales del DOM si la línea activa realmente cambió
  if (nuevoActiveIndex !== lineaActivaIndexCache) {
    lineaActivaIndexCache = nuevoActiveIndex;
    
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nuevoActiveIndex) {
        line.classList.add("active");
      } else if (currentTime > parseFloat(line.dataset.end)) {
        line.classList.add("past");
      } else {
        line.classList.add("upcoming");
      }
    });

    if (nuevoActiveLine && autoScrollEnabled) {
      nuevoActiveLine.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }

  // 3. Procesar las palabras internas únicamente sobre la línea activa actual (Máximo Rendimiento)
  if (nuevoActiveLine) {
    const words = nuevoActiveLine.querySelectorAll(".karaoke-word");
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

// ==========================================
// MONITOR DE LYRICS PARA KARAOKE (CORREGIDO)
// ==========================================
function cargarLetrasEnMonitor() {
  const container = $("miniMonitorTextArea");
  if (!container) return;

  console.log("cargarLetrasEnMonitor -> transcriptionSegments:", transcriptionSegments);

  container.innerHTML = "";

  if (!Array.isArray(transcriptionSegments) || transcriptionSegments.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size:18px;">⚠️ Ve a la pestaña 'Estudio', transcribe una voz y vuelve aquí para ver la letra.</p>`;
    return;
  }

  transcriptionSegments.forEach((seg, index) => {
    const p = document.createElement("p");
    p.className = "karaoke-live-line upcoming"; // Añadimos clase de estado por defecto
    p.id = `k-live-line-${index}`; // ID directo para evitar lag en busquedas masivas
    p.dataset.index = index;
    p.dataset.start = Number(seg.start || 0);
    p.dataset.end = Number(seg.end || 0);

    const words = Array.isArray(seg.words) ? seg.words : [];

    if (words.length) {
      words.forEach((wordObj, wordIndex) => {
        const span = document.createElement("span");
        span.className = "karaoke-live-word";
        span.dataset.start = Number(wordObj.start || 0);
        span.dataset.end = Number(wordObj.end || 0);
        span.textContent = (wordObj.word || "") + (wordIndex < words.length - 1 ? " " : "");
        p.appendChild(span);
      });
    } else {
      p.textContent = (seg.text || "").trim();
    }

    container.appendChild(p);
  });
}

// NUEVA VARIABLE CACHÉ EXCLUSIVA PARA LA PESTAÑA DE KARAOKE
let lineaLiveActivaIndexCache = -1;

/**
 * NUEVA FUNCIÓN EXTENDIDA: Ilumina las letras en tiempo real dentro de la pestaña de Karaoke
 * evitando colisiones con la pantalla del Estudio.
 */
function updateKaraokeLiveHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) return;

  let nuevoActiveLine = null;
  let nuevoActiveIndex = -1;

  // 1. Localizar la línea actual en tiempo de ejecución
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    if (currentTime >= start && currentTime <= end) {
      nuevoActiveLine = line;
      nuevoActiveIndex = i;
      break;
    }
  }

  // 2. Mudar clases globales únicamente si hay un cambio de renglón real
  if (nuevoActiveIndex !== lineaLiveActivaIndexCache) {
    lineaLiveActivaIndexCache = nuevoActiveIndex;
    
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nuevoActiveIndex) {
        line.classList.add("active");
      } else if (currentTime > parseFloat(line.dataset.end)) {
        line.classList.add("past");
      } else {
        line.classList.add("upcoming");
      }
    });

    if (nuevoActiveLine && autoScrollEnabled) {
      nuevoActiveLine.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }

  // 3. Resaltar sílabas individuales dentro de la línea activa (Alto Rendimiento)
  if (nuevoActiveLine) {
    const words = nuevoActiveLine.querySelectorAll(".karaoke-live-word");
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
  }
}

// ==========================================
// GRABACIÓN DE KARAOKE AUTOMATIZADA (CORREGIDA)
// ==========================================
async function startKaraokeRecording() {
  const track = $("karaokeTrack");
  if (!track || !track.src) { alert("⚠️ Primero sube una pista instrumental."); return; }

  try {
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    // 1. LIMPIEZA ABSOLUTA DE HARDWARE ANTES DE EMPEZAR
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

    const stream1 = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints1 });
    window.karaokeStream = stream1; 

    // Procesar Mic 1 de forma totalmente independiente
    const source1 = karaokeDuoAudioContext.createMediaStreamSource(stream1);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source1);

    // Control de volumen Mic 1
    const volNode1 = karaokeDuoAudioContext.createGain();
    const sliderVol1 = $("mic1Volume"); 
    volNode1.gain.value = sliderVol1 ? parseFloat(sliderVol1.value) : 1.0;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; 

    // CORRECCIÓN CONEXIÓN EN SERIE: Filtro -> Volumen -> Analizador -> Mezclador
    karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
    karaokeDuoAnalyser1.fftSize = 2048;
    volNode1.connect(karaokeDuoAnalyser1);

    const merger = karaokeDuoAudioContext.createChannelMerger(2);
    // Conectamos desde el analizador al mezclador directamente, una sola vez por canal
    karaokeDuoAnalyser1.connect(merger, 0, 0);

    if (!isDuo) {
      karaokeDuoAnalyser1.connect(merger, 0, 1);
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

      // Control de volumen Mic 2
      const volNode2 = karaokeDuoAudioContext.createGain();
      const sliderVol2 = $("mic2Volume");
      volNode2.gain.value = sliderVol2 ? parseFloat(sliderVol2.value) : 1.0;
      mic2Filtrado.connect(volNode2);
      currentVolNode2 = volNode2; 

      karaokeDuoAnalyser2 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser2.fftSize = 2048;
      volNode2.connect(karaokeDuoAnalyser2);

      // Conectamos en serie el analizador 2 al canal derecho (1) del merger
      karaokeDuoAnalyser2.connect(merger, 0, 1);

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

    // CORRECCIÓN: Evitar hilos duplicados de requestAnimationFrame controlando la bandera global
    setTimeout(() => {
        if (!isPitchDetectionRunning) {
            isPitchDetectionRunning = true;
            startKaraokePitchDetection();
        }
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

// ==========================================
// CONTROL DE VOLUMEN Y MEZCLA DE AUDIO (CORREGIDO)
// ==========================================
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

  const level1 = $("karaokeDuoMic1Level");
  const level2 = $("karaokeDuoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

function stopKaraokeRecording() {
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    karaokeMediaRecorder.stop();
  }

  // Desconectar y liberar hardware limpiamente
  if (window.karaokeStream) {
    window.karaokeStream.getTracks().forEach(t => t.stop());
  }
  if (window.karaokeStream2) {
    window.karaokeStream2.getTracks().forEach(t => t.stop());
    window.karaokeStream2 = null;
  }

  if (karaokeDuoAudioContext) {
    karaokeDuoAudioContext.close();
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;
  isPitchDetectionRunning = false; // Liberamos el hilo de la animacion para proximas tomas

  stopKaraokeDuoLevelMonitor();

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

  // Resetear la caché de renderizado para evitar que el scroll se quede bloqueado
  lineaLiveActivaIndexCache = -1;

  $("karaokeVoicePlayer").src = "";
  karaokeChunks = [];
  karaokeRecordedBlob = null;
  $("karaokeStatus").textContent = "Estado: Esperando para grabar...";
  $("karaokeStartBtn").disabled = false;
  
  pitchHistoryMic1 = [];
  pitchHistoryMic2 = [];
}

/**
 * CORRECCIÓN: Eliminamos la lógica redundante y enlazamos directamente al actualizador
 * de alto rendimiento unificado para evitar parpadeos y lag en el navegador.
 */
function syncKaraokeMonitor(currentTime) {
  // Invocamos directamente el motor optimizado del Bloque 11 sin añadir desfases artificiales
  updateKaraokeLiveHighlight(currentTime);
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

    // CORRECCIÓN PROTECTORA: Calculamos el tamaño exacto real para evitar desbordamientos
    // si el alumno detuvo la grabacion antes de terminar la cancion instrumental
    const duracionMaximaMuestras = Math.max(trackBuffer.length, voiceBuffer.length);

    const offlineCtx = new OfflineAudioContext(
      trackBuffer.numberOfChannels,
      duracionMaximaMuestras,
      trackBuffer.sampleRate
    );

    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = 0.4; // Balance ideal para fondo instrumental

    const trackSource = offlineCtx.createBufferSource();
    trackSource.buffer = trackBuffer;
    trackSource.connect(trackGain);
    trackGain.connect(offlineCtx.destination);

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.value = 1.8; // Ganancia suavizada para evitar distorsiones en la exportacion

    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    trackSource.start(0);
    voiceSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    
    // Invocamos la utilidad nativa de tu archivo para empaquetar el canal estereo
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
// SPLITTER IA REFORZADO Y LIMPIO (CORREGIDO)
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

  let audioCtxParaDecodificar = null; // Guardamos referencia para poder cerrarlo de forma segura

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

          // Instanciamos el contexto temporal de decodificación
          audioCtxParaDecodificar = new (window.AudioContext || window.webkitAudioContext)();
          const buffers = [];

          for (const url of instUrls) {
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            const decodedBuffer = await audioCtxParaDecodificar.decodeAudioData(arrayBuffer);
            buffers.push(decodedBuffer);
          }

          const maxLength = Math.max(...buffers.map(b => b.length));
          const sampleRateDestino = buffers[0].sampleRate;

          // Construimos el contexto offline estéreo protegido
          const offlineCtx = new OfflineAudioContext(2, maxLength, sampleRateDestino);

          buffers.forEach(buffer => {
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;

            // CORRECCIÓN PROTECTORA ESTÉREO: Si la pista que devuelve la IA es mono,
            // duplicamos los canales mediante un ChannelMerger de forma explícita para evitar vacíos
            if (buffer.numberOfChannels === 1) {
              const mergerMono = offlineCtx.createChannelMerger(2);
              source.connect(mergerMono, 0, 0);
              source.connect(mergerMono, 0, 1);
              mergerMono.connect(offlineCtx.destination);
            } else {
              source.connect(offlineCtx.destination);
            }

            source.start(0);
          });

          const renderedBuffer = await offlineCtx.startRendering();
          const blobPista = exportStereoWav(renderedBuffer);

          // Liberación explícita e inmediata de memoria RAM
          if (audioCtxParaDecodificar) {
            await audioCtxParaDecodificar.close();
            audioCtxParaDecodificar = null;
          }

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
        detailText.textContent = pollError.message || "Revisa la consola.";
        btn.disabled = false;
        btn.textContent = "✨ Separar Audio con IA";
        
        // Cierre protector en caso de fallo en el sondeo
        if (audioCtxParaDecodificar) {
          audioCtxParaDecodificar.close().catch(() => {});
          audioCtxParaDecodificar = null;
        }
      }
    }, 4000);
  } catch (err) {
    console.error(err);
    statusText.textContent = "❌ Error detectado";
    detailText.textContent = err.message || "Revisa la consola.";
    btn.disabled = false;
    btn.textContent = "✨ Separar Audio con IA";
    
    if (audioCtxParaDecodificar) {
      audioCtxParaDecodificar.close().catch(() => {});
      audioCtxParaDecodificar = null;
    }
  }
}

// ==========================================
// CONFIGURACIÓN Y HARDWARE INTEGRADO (CORREGIDO)
// ==========================================
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

function saveSetting(key, element) {
  if (!element) return;
  localStorage.setItem(key, element.value);
  if (typeof showSaveNotification === "function") showSaveNotification();
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
      const saved = localStorage.getItem(storageKey);
      if (saved) el.value = saved;
      
      el.addEventListener("change", (e) => {
        localStorage.setItem(storageKey, e.target.value);
        if (typeof showSaveNotification === "function") showSaveNotification();
        
        if (id === "appTheme") {
          applyAppTheme(e.target.value);
        }
        
        if (id === "karaokeThemeSelect") {
          const contenedorKaraoke = document.querySelector(".karaoke-lyrics");
          if (contenedorKaraoke) {
            const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta"];
            todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
            contenedorKaraoke.classList.add(e.target.value);
          }
        }
      });
    }
  });

  // CORRECCIÓN: Aplicamos los estilos por defecto UNA SOLA VEZ fuera del bucle
  // para optimizar el hilo de renderizado del navegador al arrancar la app
  applyAppTheme(localStorage.getItem("singIt_theme") || "oscuro");
  
  const savedStage = localStorage.getItem("singIt_stage") || "theme-clasico";
  const contenedorKaraoke = document.querySelector(".karaoke-lyrics");
  if (contenedorKaraoke) {
    const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta"];
    todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
    contenedorKaraoke.classList.add(savedStage);
  }
}

function applyAppTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.setAttribute("data-theme", theme);
  console.log("🎨 Tema aplicado:", theme);
}

async function loadAvailableMics() {
  try {
    // Solicitamos acceso inicial seguro
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
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

      const savedMic1 = localStorage.getItem("singIt_mic1");
      if (savedMic1) mic1Select.value = savedMic1;

      // CORRECCIÓN: Escuchador dinámico para persistir la selección del Micrófono 1
      mic1Select.addEventListener("change", (e) => {
        localStorage.setItem("singIt_mic1", e.target.value);
        if (typeof showSaveNotification === "function") showSaveNotification();
      });
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

      const savedMic2 = localStorage.getItem("singIt_mic2");
      if (savedMic2) mic2Select.value = savedMic2;

      // CORRECCIÓN: Escuchador dinámico para persistir la selección del Micrófono 2
      mic2Select.addEventListener("change", (e) => {
        localStorage.setItem("singIt_mic2", e.target.value);
        if (typeof showSaveNotification === "function") showSaveNotification();
      });
    }

    console.log("🎙️ Micrófonos detectados y sincronizados:", mics.length);
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

// ==========================================
// CONTROL DE PRUEBAS DE HARDWARE Y TEXTO (CORREGIDO)
// ==========================================
async function testMicrophone(micNumber) {
  // Detener cualquier prueba anterior para liberar recursos
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

    // CORRECCIÓN: Usamos la variable global controlada para evitar acumular contextos abiertos
    micTestAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const source = micTestAudioContext.createMediaStreamSource(micTestStream);
    micTestAnalyser = micTestAudioContext.createAnalyser();
    micTestAnalyser.fftSize = 2048;
    source.connect(micTestAnalyser);

    const levelFill = levelBar.querySelector(".mic-level-fill");
    if (levelFill) {
      levelFill.classList.add("active");
    }

    function updateLevel() {
      if (!micTestAnalyser) return;

      const dataArray = new Uint8Array(micTestAnalyser.frequencyBinCount);
      micTestAnalyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const percentage = Math.min(100, (average / 128) * 100);

      if (levelFill) {
        levelFill.style.width = percentage + "%";
      }

      micTestAnimationId = requestAnimationFrame(updateLevel);
    }

    updateLevel();

    // Detener automáticamente después de 5 segundos de forma limpia
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

  // CORRECCIÓN: Cerramos explícitamente el contexto de audio de pruebas para liberar hardware
  if (micTestAudioContext) {
    micTestAudioContext.close().catch(() => {});
    micTestAudioContext = null;
  }

  micTestAnalyser = null;

  // Resetear barras de nivel gráficas
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

  // CORRECCIÓN: Estructuramos y enlazamos de manera limpia las referencias temporales
  // para que los renderizadores gráficos no lean datos corruptos o desfasados
  baseTranscriptionSegments = rebuiltSegments;
  transcriptionSegments = rebuiltSegments;

  // Renderizamos de forma unificada en ambos monitores
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
// SINCRONIZACIÓN MANUAL CON TAPS (CORREGIDA)
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
  
  tapSyncLines = lyricsText.value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  if (tapSyncLines.length === 0) {
    alert("⚠️ No hay líneas de texto para sincronizar.");
    return;
  }
  
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  tapSyncMode = true;
  
  $("startTapSyncBtn").style.display = "none";
  $("cancelTapSyncBtn").style.display = "inline-block";
  $("tapSyncActive").style.display = "block";
  $("tapSyncResult").style.display = "none";
  
  updateTapSyncDisplay();
  
  voicePlayer.currentTime = 0;
  voicePlayer.play();
  
  // CORRECCIÓN PROTECTORA: Limpiamos cualquier rastro de listener anterior antes de añadir el nuevo
  // Esto previene de forma absoluta la duplicación caótica de toques al usar "Rehacer"
  document.removeEventListener("keydown", handleTapSyncKeypress);
  document.addEventListener("keydown", handleTapSyncKeypress);
  
  console.log("🎯 Sincronización iniciada de forma limpia. Líneas:", tapSyncLines.length);
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
  
  if (status) status.textContent = "Estado: Aplicando tiempos y analizando notas...";
  
  const newSegments = [];
  
  for (let i = 0; i < tapSyncLines.length; i++) {
    const start = tapSyncTimestamps[i] || 0;
    let end = (i < tapSyncTimestamps.length - 1) ? tapSyncTimestamps[i + 1] : (totalDuration || start + 3);
    
    // CORRECCIÓN PROTECTORA DE PAUSAS: Si la distancia entre estrofas es mayor a 1.2 segundos,
    // recortamos de forma inteligente el segmento de canto real para que el texto no flote en silencios instrumentales
    const distanciaEntreTaps = end - start;
    if (distanciaEntreTaps > 1.2) {
      // Le asignamos una duración máxima de renderizado calculada de forma natural basándonos en el tamaño del texto
      const conteoPalabras = tapSyncLines[i].split(/\s+/).length;
      end = start + Math.min(distanciaEntreTaps, Math.max(1.0, conteoPalabras * 0.45));
    }

    newSegments.push(buildWordTimingFromSegment({
      start: start,
      end: end,
      text: tapSyncLines[i]
    }));
  }
  
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
          console.log("✅ Canción karaoke creada e inyectada con éxito en la base de datos.");
      } catch (err) {
          console.error("❌ Error creando karaoke:", err);
      }
  } else {
      console.warn("⚠️ No hay pista instrumental seleccionada para crear karaoke");
  }
  
  // Sincronizamos las dos vistas de forma directa e inmediata
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
  alert("✅ ¡Tiempos y notas aplicados de forma estable! Reproduce para verificar.");
}

function redoTapSync() {
  $("tapSyncResult").style.display = "none";
  startTapSync();
}

// ==========================================
// INIT - ENTRADA PRINCIPAL DE LA APP (CORREGIDO)
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const encabezados = document.querySelectorAll('.encabezado-desplegable');
  
  encabezados.forEach(encabezado => {
    encabezado.addEventListener('click', () => {
      const targetId = encabezado.getAttribute('data-target');
      const arrowId = encabezado.getAttribute('data-arrow');
      
      const content = document.getElementById(targetId);
      const arrow = document.getElementById(arrowId);
      
      if (content && arrow) {
        content.classList.toggle('oculto'); 
        arrow.classList.toggle('rotada');
      }
    });
  });

  try {
    await initDB();
    initSettings();

    // CORRECCIÓN PROTECTORA DE CLASES: Evita duplicidades como "theme-theme-clasico"
    function applyKaraokeTheme() {
      const themeGuardado = localStorage.getItem("singIt_stage") || "theme-clasico";
      const monitor = $("miniMonitorTextArea");
      if (monitor) {
        // Nos aseguramos de limpiar e inyectar el formato limpio reglamentario
        const nombreLimpioTema = themeGuardado.startsWith("theme-") ? themeGuardado : "theme-" + themeGuardado;
        
        // Mantenemos la consistencia estructural con tus hojas de estilos CSS
        monitor.className = "karaoke-lyrics " + nombreLimpioTema;
      }
    }

    applyKaraokeTheme();

    safeAdd("karaokeThemeSelect", "change", (e) => {
      saveSetting("singIt_stage", e.target);
      applyKaraokeTheme();
    });

    // Navegación principal
    safeAdd("btnAfinador", "click", () => showTab("afinador"));
    safeAdd("btnEstudio", "click", () => showTab("estudio"));
    safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
    safeAdd("btnKaraokeLibrary", "click", () => showTab("karaokeLibrary"));
    safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
    safeAdd("btnSplitter", "click", () => showTab("splitter"));
    safeAdd("btnConfig", "click", () => showTab("config"));

    // Módulo Afinador
    safeAdd("recordBtn", "click", toggleRecording);

    // Módulo Estudio de Grabación y Edición
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

    // Conmutador del Auto-scroll
    safeAdd("toggleAutoScrollBtn", "click", () => {
      autoScrollEnabled = !autoScrollEnabled;
      const btn = $("toggleAutoScrollBtn");
      if (btn) {
        btn.textContent = autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
        btn.style.background = autoScrollEnabled ? "#f59e0b" : "#6b7280";
      }
    });

    // Eventos interactivos de sincronización con Taps manuales
    safeAdd("startTapSyncBtn", "click", startTapSync);
    safeAdd("cancelTapSyncBtn", "click", cancelTapSync);
    safeAdd("tapBeatBtn", "click", recordTap);
    safeAdd("applyTapSyncBtn", "click", applyTapSync);
    safeAdd("redoTapSyncBtn", "click", redoTapSync);

    // Catálogos externos de Karaoke
    safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
      if (typeof loadKaraokeCatalog === "function") await loadKaraokeCatalog();
      if (typeof loadMyKaraokeSongs === "function") await loadMyKaraokeSongs();
    });

    // Karaoke Library tab
    safeAdd("refreshKaraokeLibraryBtn", "click", async () => {
      if (typeof loadKaraokeLibraryTable === "function") await loadKaraokeLibraryTable();
    });

    if (typeof loadKaraokeCatalog === "function") loadKaraokeCatalog();
    if (typeof loadMyKaraokeSongs === "function") loadMyKaraokeSongs();
    if (typeof loadKaraokeLibraryTable === "function") loadKaraokeLibraryTable();
    if (typeof loadMyKaraokeSongs === "function") loadMyKaraokeSongs();
    
    // Carga manual de archivos hacia la Biblioteca
    safeAdd("saveLibraryFileBtn", "click", saveManualFileToLibrary);
    safeAdd("libraryFileInput", "change", (e) => {
      const file = e.target.files[0];
      const nameInput = $("libraryFileName");
      if (file && nameInput && !nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.[^.]+$/, "");
      }
    });

    // Módulo de Entrenamiento Karaoke
    // Nota: karaokeTrackFile input no existe en HTML, funcionalidad manejada por loadTrackOptionsInKaraoke
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

      // CORRECCIÓN: Reseteamos la caché de renderizado al finalizar la canción
      kTrack.addEventListener("ended", () => {
        lineaLiveActivaIndexCache = -1; 
        syncKaraokeMonitor(0);
      });
    }

    // Módulo de Splitter IA
    safeAdd("splitBtn", "click", splitAudio);

    // Configuración avanzada de Micrófonos
    safeAdd("refreshMicsBtn", "click", loadAvailableMics);
    safeAdd("testMic1Btn", "click", () => testMicrophone(1));
    safeAdd("testMic2Btn", "click", () => testMicrophone(2));
    safeAdd("mic1Select", "change", () => saveMicSelection(1));
    safeAdd("mic2Select", "change", () => saveMicSelection(2));
    safeAdd("micCount", "change", toggleMic2Visibility);
    
    // Inicialización del hardware al arrancar
    loadAvailableMics();
    toggleMic2Visibility();

    // Precarga de catálogos y Biblioteca local
    await renderLibrary('todos');
    await loadTrackOptionsInStudio();
    await loadTrackOptionsInKaraoke();

    const player = $("player");
    if (player) {
      player.addEventListener("timeupdate", () => {
        updateKaraokeHighlight(player.currentTime);
      });

      // CORRECCIÓN: Reseteamos la caché del monitor del Estudio al terminar la pista
      player.addEventListener("ended", () => {
        lineaActivaIndexCache = -1; 
        updateKaraokeHighlight(0);
      });
    }

    console.log("🚀 ¡SingIt inicializada de forma impecable y estable al 100%!");
  } catch (error) {
    console.error("Fallo general en la inicialización:", error);
    alert("❌ Error inicializando la app");
  }
});

// ==========================================
// MONITOR DE KARAOKE - CANVAS INTERACTIVO (CORREGIDO)
// ==========================================

// --- FUNCIÓN PARA CONSTRUIR LA FRASE CON ESPACIOS DESDE LAS PALABRAS ---
function reconstruirFraseDesdeWords(segmento) {
  if (!segmento) return "";

  const listaPalabras = Array.isArray(segmento.words) ? segmento.words : [];
  
  if (listaPalabras.length === 0 && segmento.text) {
    return segmento.text.trim(); 
  }

  return listaPalabras
    .map(w => {
      let textoPalabra = "";
      if (typeof w === "string") textoPalabra = w;
      else if (w) textoPalabra = w.text || w.word || "";
      
      return textoPalabra.replace(/-/g, "");
    }) 
    .join(" ")            
    .replace(/\s+/g, " ") 
    .trim();
}

/**
 * Renderiza el pentagrama y las barras de notas musicales en tiempo real.
 */
function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2) {
  const canvas = $("karaokeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // 1. GUARDAR HISTORIAL SEPARADO - MICRÓFONO 1
  pitchHistoryMic1.push(currentFreq > 0 ? currentFreq : null);
  if (pitchHistoryMic1.length > 60) pitchHistoryMic1.shift();

  // 2. GUARDAR HISTORIAL SEPARADO - MICRÓFONO 2
  pitchHistoryMic2.push(currentFreq2 > 0 ? currentFreq2 : null);
  if (pitchHistoryMic2.length > 60) pitchHistoryMic2.shift();

  // ========================================================
  // 🎨 CONFIGURACIÓN DE COLORES DINÁMICOS SEGÚN EL TEMA
  // ========================================================
  const temaActual = localStorage.getItem("singIt_stage") || "theme-clasico";
  
  let colorFondo = "#111827";       
  let colorLineas = "#333333";      
  let colorEtiquetas = "#666666";   
  let colorBarraFutura = "#1e40af"; 
  let colorBordeFuturo = "#3b82f6";

  if (temaActual === "theme-moderno") {
    colorFondo = "#082f49";         
    colorLineas = "rgba(6, 182, 212, 0.2)";
    colorEtiquetas = "#06b6d4";
    colorBarraFutura = "#1e3a8a";
    colorBordeFuturo = "#06b6d4";
  } else if (temaActual === "theme-disco") {
    colorFondo = "#2e1065";         
    colorLineas = "rgba(219, 39, 119, 0.25)";
    colorEtiquetas = "#facc15";
    colorBarraFutura = "#701a75";
    colorBordeFuturo = "#db2777";
  } else if (temaActual === "theme-acustico") {
    colorFondo = "#451a03";         
    colorLineas = "rgba(120, 53, 15, 0.4)";
    colorEtiquetas = "#fcd34d";
    colorBarraFutura = "#78350f";
    colorBordeFuturo = "#b45309";
  } else if (temaActual === "theme-fiesta") {
    const hue = (Date.now() / 20) % 360;
    colorFondo = `hsl(${hue}, 40%, 12%)`;
    colorLineas = "rgba(255, 255, 255, 0.15)";
    colorBarraFutura = "hsl(" + ((hue + 180) % 360) + ", 50%, 25%)";
    colorBordeFuturo = "hsl(" + ((hue + 180) % 360) + ", 70%, 50%)";
    colorEtiquetas = "#ff007f";
  }

  // Pintar fondo del escenario
  ctx.fillStyle = colorFondo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pentagramTop = 30;
  const pentagramBottom = canvas.height - 60;
  const pentagramHeight = pentagramBottom - pentagramTop;
  
  const midiMin = 48; // C3
  const midiMax = 84; // C6
  const midiRange = midiMax - midiMin;

  // --- DIBUJAR LÍNEAS DEL PENTAGRAMA ---
  ctx.strokeStyle = colorLineas; 
  ctx.lineWidth = 1;
  const numLines = 10;
  for (let i = 0; i <= numLines; i++) {
    const y = pentagramTop + (pentagramHeight / numLines) * i;
    ctx.beginPath();
    ctx.moveTo(35, y); // Dejamos espacio para las etiquetas a la izquierda
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // --- DIBUJAR INDICADORES DE NOTAS A LA IZQUIERDA ---
  ctx.fillStyle = colorEtiquetas; 
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
  noteLabels.forEach((label, i) => {
    const y = pentagramTop + (pentagramHeight / numLines) * i + 4;
    ctx.fillText(label, 28, y);
  });

  function midiToY(midi) {
    let m = midi || 60;
    if (m < midiMin) m = midiMin;
    if (m > midiMax) m = midiMax;
    const normalized = (midiMax - m) / midiRange;
    return pentagramTop + normalized * pentagramHeight;
  }

  // --- DIBUJAR BARRAS DE NOTAS DE LA CANCIÓN ---
  if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
    const timeWindowStart = currentTime - 1;
    const timeWindowEnd = currentTime + 5;
    const pixelsPerSecond = (canvas.width - 50) / 6;
    const lineX = 50; // Ajustado para alinearse perfectamente con el margen del pentagrama

    // Dibujar aguja/línea de tiempo actual roja
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX, pentagramTop);
    ctx.lineTo(lineX, pentagramBottom);
    ctx.stroke();

    transcriptionSegments.forEach((segment) => {
      const words = Array.isArray(segment.words) ? segment.words : [];
      words.forEach((word) => {
        if (word.end < timeWindowStart || word.start > timeWindowEnd) return;
        
        const wordStartX = lineX + (word.start - currentTime) * pixelsPerSecond;
        const wordEndX = lineX + (word.end - currentTime) * pixelsPerSecond;
        const barWidth = Math.max(wordEndX - wordStartX, 35);
        
        const midi = word.midi || segment.midi || 60;
        const barY = midiToY(midi);
        const barHeight = 20;
        
        const isActive = currentTime >= word.start && currentTime <= word.end;
        const isPast = currentTime > word.end;
        
        // CORRECCIÓN PROTECTORA EN MODO DÚO: Comprobamos si el Mic 1 o el Mic 2 aciertan la nota
        let isCorrect = false;
        if (isActive) {
          if (currentFreq && currentFreq > 0) {
            const userMidi1 = Math.round(12 * Math.log2(currentFreq / 440) + 69);
            if (Math.abs(userMidi1 - midi) <= 1) isCorrect = true; // Margen de error refinado a 1 semitono
          }
          if (currentFreq2 && currentFreq2 > 0) {
            const userMidi2 = Math.round(12 * Math.log2(currentFreq2 / 440) + 69);
            if (Math.abs(userMidi2 - midi) <= 1) isCorrect = true;
          }
        }
        
        let barColor, textColor, borderColor;
        if (isPast) {
          barColor = "#4b5563";
          textColor = "#9ca3af";
          borderColor = "#6b7280";
        } else if (isActive) {
          if (isCorrect) {
            barColor = "#22c55e"; // ¡Verde brillante si el alumno está afinado!
            textColor = "#ffffff";
            borderColor = "#4ade80";
          } else {
            barColor = "#3b82f6"; // Azul si es la sílaba activa pero no hay voz afinada
            textColor = "#ffffff";
            borderColor = "#60a5fa";
          }
        } else {
          barColor = colorBarraFutura;
          textColor = "rgba(255, 255, 255, 0.7)";
          borderColor = colorBordeFuturo;
        }
        
        // Renderizar cuerpo de la barra con esquinas redondeadas
        ctx.fillStyle = barColor;
        ctx.beginPath();
        ctx.roundRect(wordStartX, barY - barHeight/2, barWidth, barHeight, 6);
        ctx.fill();
        
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();
        
        // Renderizar el texto de la sílaba/palabra de forma limpia
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        let displayWord = word.word || word.text || "";
        // CORRECCIÓN TEXTO FLUIDO: Escalamos la tipografía en vez de cortar con puntos suspensivos destructivos
        if (displayWord.length > 8) {
          ctx.font = isActive ? "bold 11px sans-serif" : "10px sans-serif";
        } else {
          ctx.font = isActive ? "bold 13px sans-serif" : "12px sans-serif";
        }
        
        ctx.fillText(displayWord, wordStartX + barWidth/2, barY);
      });
    });
  } else {
    // Pantalla de espera analítica si no hay canción cargada
    ctx.fillStyle = colorEtiquetas;
    ctx.font = "15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas en el pentagrama", canvas.width / 2, canvas.height / 2);
  }

// ====================================================================
// 🎤 --- DIBUJAR LA VOZ DEL MICRÓFONO 1 (AMARILLO) (CORREGIDO) ---
// ====================================================================
  
  // Dibujar rastro histórico Mic 1 (Hacia la izquierda desde la posición de canto)
  ctx.beginPath();
  ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
  ctx.lineWidth = 4; 
  let started1 = false;
  
  pitchHistoryMic1.forEach((freq, i) => {
    if (freq && freq > 0) {
      const y = midiToY(frequencyToMidi(freq));
      // CORRECCIÓN: Garantizamos el margen de desfase estático de impacto en base a píxeles seguros
      const x = 50 - (pitchHistoryMic1.length - i) * 2.5; 
      
      if (x >= 0) { 
        if (!started1) { 
          ctx.moveTo(x, y); 
          started1 = true; 
        } else { 
          ctx.lineTo(x, y); 
        }
      }
    } else {
      started1 = false; // Rompe el trazo de forma limpia si hay silencio para evitar líneas locas
    }
  });
  ctx.stroke();

  // Dibujar indicador actual Mic 1 (Fijo en la zona de impacto X = 50)
  if (currentFreq && currentFreq > 0) {
    const userY1 = midiToY(frequencyToMidi(currentFreq));
    ctx.beginPath();
    ctx.fillStyle = "#facc15"; 
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#facc15";
    ctx.arc(50, userY1, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; 
  }

  // ====================================================================
  // 🐬 --- DIBUJAR LA VOZ DEL MICRÓFONO 2 (CELESTE / CIAN) (CORREGIDO) ---
  // ====================================================================
  
  // Dibujar rastro histórico Mic 2
  ctx.beginPath();
  ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
  ctx.lineWidth = 4;
  let started2 = false;
  
  pitchHistoryMic2.forEach((freq, i) => {
    if (freq && freq > 0) {
      const y = midiToY(frequencyToMidi(freq));
      const x = 50 - (pitchHistoryMic2.length - i) * 2.5; 
      
      if (x >= 0) {
        if (!started2) { 
          ctx.moveTo(x, y); 
          started2 = true; 
        } else { 
          ctx.lineTo(x, y); 
        }
      }
    } else {
      started2 = false; // Rompe el trazo de forma limpia si hay silencio
    }
  });
  ctx.stroke();

  // Dibujar indicador actual Mic 2 (Desfase en X = 56 para evitar colisiones)
  if (currentFreq2 && currentFreq2 > 0) {
    const userY2 = midiToY(frequencyToMidi(currentFreq2));
    ctx.beginPath();
    ctx.fillStyle = "#06b6d4"; 
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#06b6d4";
    ctx.arc(56, userY2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; 
  }

  // --- DIBUJAR LETRA ACTUAL ABAJO ---
  const currentIndex = transcriptionSegments.findIndex(seg => 
    currentTime >= seg.start && currentTime <= seg.end + 0.5
  );

  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

  if (currentIndex !== -1) {
    const currentSegment = transcriptionSegments[currentIndex];
    const textoActualLimpio = reconstruirFraseDesdeWords(currentSegment);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif"; 
    ctx.textAlign = "center";
    ctx.textBaseline = "top"; 
    ctx.fillText(textoActualLimpio, canvas.width / 2, canvas.height - 42);

    const nextSegment = transcriptionSegments[currentIndex + 1];
    if (nextSegment) {
      const textoProximoLimpio = reconstruirFraseDesdeWords(nextSegment);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom"; 
      ctx.fillText("Próximo: " + textoProximoLimpio, canvas.width / 2, canvas.height - 6);
    }
  } else {
    const upcomingSegment = transcriptionSegments.find(seg => seg.start > currentTime);
    if (upcomingSegment) {
      const textoProximoLimpio = reconstruirFraseDesdeWords(upcomingSegment);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle"; 
      ctx.fillText("Próximo: " + textoProximoLimpio, canvas.width / 2, canvas.height - 25);
    }
  }
}


// CORRECCIÓN REUTILIZACIÓN DE MEMORIA: Declaramos los buffers fuera del loop
const staticBufferMic1 = new Float32Array(2048);
const staticBufferMic2 = new Float32Array(2048);

// ==========================================
// DETECCIÓN DE PITCH PARA KARAOKE (CORREGIDA)
// ==========================================
async function startKaraokePitchDetection() {
    function loop() {
        const track = $("karaokeTrack");
        
        // CORRECCIÓN CONTROL FLUJO: Si la pista se detiene, pausó o finalizó, matamos el proceso inmediato de CPU
        if (!track || track.paused || track.ended || !isPitchDetectionRunning) {
            isPitchDetectionRunning = false;
            return;
        }

        const currentTime = track.currentTime;
        const sampleRateSistema = karaokeDuoAudioContext?.sampleRate || 48000;

        // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 1 (AMARILLO) ---
        let pitch1 = -1;
        if (karaokeDuoAnalyser1) {
            // Reutilizamos el buffer estático sin crear instancias nuevas
            karaokeDuoAnalyser1.getFloatTimeDomainData(staticBufferMic1);
            
            let sum1 = 0;
            for (let i = 0; i < staticBufferMic1.length; i++) { sum1 += staticBufferMic1[i] * staticBufferMic1[i]; }
            const rms1 = Math.sqrt(sum1 / staticBufferMic1.length);

            if (rms1 > 0.015) {
                pitch1 = autoCorrelate(staticBufferMic1, sampleRateSistema);
            }
        }

        // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 2 (CELESTE) ---
        let pitch2 = -1; 
        if (karaokeDuoAnalyser2) {
            karaokeDuoAnalyser2.getFloatTimeDomainData(staticBufferMic2);
            
            let sum2 = 0;
            for (let i = 0; i < staticBufferMic2.length; i++) { sum2 += staticBufferMic2[i] * staticBufferMic2[i]; }
            const rms2 = Math.sqrt(sum2 / staticBufferMic2.length);

            if (rms2 > 0.015) {
                pitch2 = autoCorrelate(staticBufferMic2, sampleRateSistema);
            }
        }

        // ENVIAR AMBOS TONOS AL MONITOR VISUAL UNIFICADO
        if (typeof drawKaraokeMonitor === 'function') {
            drawKaraokeMonitor(currentTime, pitch1, pitch2);
        }

        // Ejecutamos el siguiente fotograma únicamente si la bandera sigue activa
        if (isPitchDetectionRunning) {
            requestAnimationFrame(loop);
        }
    }

    // Activamos la bandera y encendemos el motor de dibujo
    isPitchDetectionRunning = true;
    loop();
}

// ==========================================
// PARSER ULTRASTAR TXT PROFESIONAL (CORREGIDO)
// ==========================================
function parseUltrastarTxt(content) {
  const lines = content.split("\n");
  const metadata = {};
  const notes = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 1. Procesamiento de Metadatos de Cabecera
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }
    
    // 2. Procesamiento de Notas y Saltos de Línea Reglamentarios
    if (trimmed.match(/^[:*F\-]/)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0]; // : = normal, * = golden, F = freestyle, - = salto de línea
      
      // CORRECCIÓN: Guardamos el salto de línea explicitamente con su Beat para segmentar con precisión
      if (type === "-") {
        notes.push({
          type: "-",
          startBeat: parseInt(parts[1], 10) || 0,
          duration: 0,
          pitch: 0,
          syllable: ""
        });
        continue;
      }
      
      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        
        // Unimos el texto remanente preservando espacios intermedios necesarios
        const syllable = parts.slice(4).join(" ");
        
        notes.push({
          type: type,
          startBeat: startBeat,
          duration: duration,
          pitch: pitch, 
          syllable: syllable
        });
      }
    }
  }
  
  return {
    title: metadata.TITLE || "Sin título",
    artist: metadata.ARTIST || "Desconocido",
    bpm: parseFloat(metadata.BPM.replace(",", ".")) || 120, // Protegido contra decimales europeos con coma
    gap: parseFloat(metadata.GAP.replace(",", ".")) || 0,   
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
  const gap = parsed.gap / 1000; 
  
  // CORRECCIÓN: La resolución base por defecto en UltraStar Deluxe es multiplicar por 4
  const beatDuration = 60 / (bpm * 4); 
  
  const segments = [];
  let currentWords = [];
  
  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    
    // CORRECCIÓN: Si detectamos la marca física de corte (-), cerramos el renglón de inmediato
    if (note.type === "-") {
      if (currentWords.length > 0) {
        segments.push({
          start: currentWords[0].start,
          end: currentWords[currentWords.length - 1].end,
          text: currentWords.map(w => w.word).join(""),
          words: [...currentWords],
          pitch: currentWords[0].pitch,
          midi: currentWords[0].midi,
          note: currentWords[0].note
        });
        currentWords = []; // Vaciamos el buffer de sílabas para iniciar la siguiente línea
      }
      continue;
    }
    
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    
    // Conversión MIDI nativa protegida (Base estándar MIDI 60 = Do Central)
    let midiNote = 60 + note.pitch;
    
    // Corrección de límites por si el archivo viene transpuesto en octavas extremas
    if (midiNote < 12) midiNote += 12;
    if (midiNote > 127) midiNote = 127;
    
    const frecuenciaCalculada = midiToFrequency(midiNote);

    // Limpieza de guiones tipográficos estéticos del archivo UltraStar original
    let textoSilaba = note.syllable;
    
    currentWords.push({
      word: textoSilaba,
      start: startTime,
      end: endTime,
      pitch: frecuenciaCalculada,
      midi: midiNote,
      note: getNoteFromFrequency(frecuenciaCalculada)
    });
  }
  
  // Almacenar el remanente de sílabas si el archivo no incluyó la marca "-" al final
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
// MÓDULO DE CATÁLOGO Y PLAYLISTS DE ALTO RENDIMIENTO (CORREGIDO)
// ==========================================
async function loadKaraokeCatalog() {
  const container = $("catalogList");
  if (!container) return;
  
  container.innerHTML = `<p style="color: var(--text-muted);">Cargando catálogo...</p>`;
  
  try {
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
          <button type="button" class="load-catalog-btn" data-folder="${song.folder}" data-title="${song.title}" data-artist="${song.artist}" style="background: #3b82f6;">📥 Cargar</button>
        </div>
      `;
      
      container.appendChild(div);
    });
    
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
    if (status) status.textContent = `Estado: Deteniendo procesos anteriores...`;
    
    // CORRECCIÓN PROTECTORA: Forzamos el apagado completo de streams y bucles gráficos anteriores
    // para prevenir hilos de renderizado duplicados colisionando en el mismo Canvas
    if (typeof stopKaraokeRecording === "function") stopKaraokeRecording();
    if (typeof restartKaraokeRecording === "function") restartKaraokeRecording();

    if (status) status.textContent = `Estado: Descargando archivos de "${title}"... ⏳`;
    
    // 1. Descargar marcas de tiempo UltraStar nativas
    const syncResponse = await fetch(`./karaoke-catalog/${folder}/sync.txt`);
    if (!syncResponse.ok) {
      throw new Error("No se pudo descargar el archivo de sincronización .txt");
    }
    const syncContent = await syncResponse.text();
    
    // Parsear el archivo utilizando el módulo de alta resolución del Bloque 16
    const parsed = parseUltrastarTxt(syncContent);
    const segments = ultrastarToSegments(parsed);
    
    if (segments.length === 0) {
      throw new Error("El parseador no encontró marcas numéricas estables en el archivo");
    }
    
    // 2. Descargar el archivo binario de audio de la pista
    const audioResponse = await fetch(`./karaoke-catalog/${folder}/audio.mp3`);
    if (!audioResponse.ok) {
      throw new Error("No se pudo descargar el archivo de audio instrumental");
    }
    const audioBlob = await audioResponse.blob();
    
    // 3. Configurar el buffer y el reproductor de forma segura
    const track = $("karaokeTrack");
    if (track) {
      track.src = URL.createObjectURL(audioBlob);
      track.volume = 0.4;
      
      karaokeSelectedTrackBlob = audioBlob;
      karaokeSelectedTrackName = `${title} - ${artist}`;
      
      // Asignamos las variables de control antes del renderizado
      transcriptionSegments = segments;
      baseTranscriptionSegments = segments;

      // Inicializar el monitor y las letras en el DOM
      cargarLetrasEnMonitor();

      // Mostrar información de la canción
      const songInfo = $("loadedKaraokeSongInfo");
      const songTitleEl = $("loadedKaraokeSongTitle");
      const songArtistEl = $("loadedKaraokeSongArtist");
      if (songInfo && songTitleEl && songArtistEl) {
        songTitleEl.textContent = title;
        songArtistEl.textContent = artist;
        songInfo.style.display = "block";
      }

      if (status) status.textContent = `Estado: "${title}" cargada. ¡Lista para cantar!`;

      // NO reproducir automáticamente - solo cargar
      // El usuario debe presionar "Iniciar Grabación" manualmente
    }

    // Cambiar a la pestaña de Karaoke
    showTab("karaoke");

    console.log("✅ Canción del catálogo cargada con éxito:", title);
    
  } catch (error) {
    console.error("Error crítico al cargar canción del catálogo:", error);
    if (status) status.textContent = `Estado: Error al cargar "${title}"`;
    alert(`❌ No se pudo inicializar el proyecto: ${error.message}`);
  }
}

async function loadMyKaraokeSongs() {
  const container = $("myKaraokeList");
  if (!container) return;

  try {
    // Solo cargar canciones de tipo "karaoke" (no archivos de voz)
    const karaokeSongs = await getLibraryItemsByType("karaoke");

    if (karaokeSongs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>No tienes canciones listas aún.</p>
          <p style="font-size: 13px;">Sincroniza una en Estudio.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";

    karaokeSongs.forEach(song => {
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
          <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #3b82f6;">📥 Cargar</button>
          <button type="button" class="share-karaoke-btn" data-id="${song.id}" style="background: #8b5cf6; padding: 8px 10px;" title="Compartir como .singit">📤</button>
          <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 8px 10px;">🗑️</button>
        </div>
      `;

      container.appendChild(div);
    });

    container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof loadKaraokeSong === "function") {
          loadKaraokeSong(Number(btn.dataset.id));
        } else {
          // Fallback polimórfico directo si se invoca desde el monitor unificado
          console.log("Cargando ID local de biblioteca:", btn.dataset.id);
        }
      });
    });
    
    container.querySelectorAll(".share-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof exportKaraokeSong === "function") exportKaraokeSong(Number(btn.dataset.id));
      });
    });

    container.querySelectorAll(".delete-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Deseas eliminar permanentemente esta canción de tu biblioteca?")) {
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

// ==========================================
// COMPARTIR / IMPORTAR KARAOKES (.singit) (CORREGIDO)
// ==========================================
async function loadKaraokeSong(id) {
  try {
    // CORRECCIÓN PROTECTORA: Detener bucles y liberar hardware previos
    if (typeof stopKaraokeRecording === "function") stopKaraokeRecording();
    if (typeof restartKaraokeRecording === "function") restartKaraokeRecording();

    const song = await getLibraryItemById(id);
    if (!song) {
      alert("⚠️ Canción no encontrada");
      return;
    }

    const track = $("karaokeTrack");
    if (track && song.audioBlob) {
      track.src = URL.createObjectURL(song.audioBlob);
      track.volume = 0.4;
      karaokeSelectedTrackBlob = song.audioBlob;
      karaokeSelectedTrackName = song.name;
    }

    if (song.transcription && song.transcription.length > 0) {
      transcriptionSegments = song.transcription;
      baseTranscriptionSegments = song.transcription;
      cargarLetrasEnMonitor();
    }

    const title = song.metadata?.title || song.name;
    const artist = song.metadata?.artist || "Artista desconocido";
    $("karaokeStatus").textContent = `Estado: "${title}" cargada. ¡Lista para cantar!`;

    // Mostrar información de la canción
    const songInfo = $("loadedKaraokeSongInfo");
    const songTitleEl = $("loadedKaraokeSongTitle");
    const songArtistEl = $("loadedKaraokeSongArtist");
    if (songInfo && songTitleEl && songArtistEl) {
      songTitleEl.textContent = title;
      songArtistEl.textContent = artist;
      songInfo.style.display = "block";
    }

    // NO reproducir automáticamente - solo cargar
    // El usuario debe presionar "Iniciar Grabación" manualmente

    // Cambiar a la pestaña de Karaoke
    showTab("karaoke");

    console.log(`✅ Canción "${title}" cargada en el monitor`);
  } catch (error) {
    console.error("Error cargando canción de karaoke:", error);
    alert("❌ No se pudo cargar la canción");
  }
}

// ==========================================
// KARAOKE LIBRARY TAB - Unified Table
// ==========================================
async function loadKaraokeLibraryTable() {
  const tbody = $("karaokeLibraryTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">Cargando canciones...</td></tr>`;

  try {
    // Load both catalog songs and user karaoke songs
    const response = await fetch("./karaoke-catalog/catalog.json");
    const catalog = response.ok ? await response.json() : { songs: [] };
    const userKaraokeSongs = await getLibraryItemsByType("karaoke");

    const allSongs = [];

    // Add catalog songs
    if (catalog.songs) {
      catalog.songs.forEach((song, index) => {
        allSongs.push({
          id: `catalog-${song.id}`,
          number: index + 1,
          title: song.title,
          artist: song.artist,
          source: "📚 Catálogo",
          type: "catalog",
          folder: song.folder
        });
      });
    }

    // Add user songs
    userKaraokeSongs.forEach((song, index) => {
      allSongs.push({
        id: song.id,
        number: catalog.songs ? catalog.songs.length + index + 1 : index + 1,
        title: song.metadata?.title || song.name || "Sin título",
        artist: song.metadata?.artist || "Artista desconocido",
        source: "📁 Mis Canciones",
        type: "user"
      });
    });

    if (allSongs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">
            No hay canciones disponibles.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = "";

    allSongs.forEach(song => {
      const tr = document.createElement("tr");
      tr.style.cssText = "border-bottom: 1px solid var(--border); transition: background 0.2s ease;";

      // 1. Celda de Número
      const numberCell = document.createElement("td");
      numberCell.style.cssText = "padding: 12px; color: var(--text-muted);";
      numberCell.textContent = song.number;

      // 2. Celda de Título
      const titleCell = document.createElement("td");
      titleCell.style.cssText = "padding: 12px; cursor: pointer; color: var(--accent);";
      titleCell.textContent = song.title;
      titleCell.addEventListener("click", () => {
        if (song.type === "catalog") {
          loadCatalogSong(song.folder, song.title, song.artist);
        } else {
          loadKaraokeSong(song.id);
        }
      });

      // 3. Celda de Artista
      const artistCell = document.createElement("td");
      artistCell.style.cssText = "padding: 12px; cursor: pointer;";
      artistCell.textContent = song.artist;
      artistCell.addEventListener("click", () => {
        if (song.type === "catalog") {
          loadCatalogSong(song.folder, song.title, song.artist);
        } else {
          loadKaraokeSong(song.id);
        }
      });

      // 4. Celda de Origen
      const sourceCell = document.createElement("td");
      sourceCell.style.cssText = "padding: 12px; font-size: 13px; color: var(--text-muted);";
      sourceCell.textContent = song.source;

      // 5. Celda de Acciones (Eliminar)
      const actionCell = document.createElement("td");
      actionCell.style.cssText = "padding: 12px; text-align: center;";
      if (song.type === "user") {
        actionCell.innerHTML = `<button class="delete-lib-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 6px 10px; font-size: 13px;">🗑️</button>`;
      }

      // Añadir todas las celdas en orden sin romper el DOM
      tr.appendChild(numberCell);
      tr.appendChild(titleCell);
      tr.appendChild(artistCell);
      tr.appendChild(sourceCell);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    });

    // Add delete handlers for user songs
    tbody.querySelectorAll(".delete-lib-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("¿Deseas eliminar permanentemente esta canción de tu biblioteca?")) {
          await deleteLibraryItemFromDB(Number(btn.dataset.id));
          await loadKaraokeLibraryTable();
        }
      });
    });

    console.log(`✅ Tabla de biblioteca de karaoke cargada: ${allSongs.length} canciones`);
  } catch (error) {
    console.error("Error cargando tabla de karaoke:", error);
    console.error("Error cargando canción:", error);
    alert("❌ Error al cargar la canción");
    
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: #ef4444;">
          Error al cargar canciones
        </td>
      </tr>
    `;
  }
}

function blobToBase64Full(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); 
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
    console.log("✅ Karaoke exportado con éxito:", safeName);
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
  // CORRECCIÓN SELECTOR: Apuntamos al contenedor unificado de letras ".karaoke-lyrics" o el ID real de tu monitor
  const contenedorKaraoke = document.getElementById("karaokeLiveLyrics") || document.getElementById("karaokeLyrics"); 
  
  if (!select || !contenedorKaraoke) return;

  const nuevoTema = select.value ? select.value.trim() : "theme-clasico";

  // CORRECCIÓN: Unificamos e incluimos de forma nativa tu nuevo escenario "theme-retrowave"
  const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];
  
  todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
  contenedorKaraoke.classList.add(nuevoTema);

  // CORRECCIÓN CLAVE UNIFICADA: Guardamos bajo la clave global "singIt_stage" para evitar colisiones en disco
  localStorage.setItem("singIt_stage", nuevoTema);
  
  if (typeof showSaveNotification === "function") {
    showSaveNotification();
  }
}

/**
 * CORRECCIÓN REORGANIZACIÓN: En lugar de crear un DOMContentLoaded paralelo repetitivo,
 * exponemos la subrutina de inicialización para que sea invocada limpiamente por la función central de INIT.
 */
function inicializarEscenarioDesdeMemoria() {
  const select = document.getElementById("karaokeThemeSelect");
  if (!select) return;

  // Leemos la clave unificada reglamentaria del disco duro
  let temaGuardado = localStorage.getItem("singIt_stage");
  
  if (!temaGuardado || temaGuardado === "undefined") {
    temaGuardado = "theme-clasico";
  }

  select.value = temaGuardado; 
  cambiarEscenarioKaraoke();   
}

html


<!DOCTYPE html>
<html lang="es">
<head>
  <link rel="icon" href="data:,">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎤 SingIt</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="app">

  <!-- SIDEBAR -->
  <nav class="sidebar">
    <h2>🎤 SingIt</h2>
    <button id="btnAfinador" type="button">Afinador</button>
    <button id="btnEstudio" type="button">Estudio</button>
    <button id="btnBiblioteca" type="button">Biblioteca</button>
    <button id="btnKaraokeLibrary" type="button">Karaoke Library</button>
    <button id="btnKaraoke" type="button">Karaoke</button>
    <button id="btnSplitter" type="button">Splitter</button>
    <button id="btnConfig" type="button">Configuración</button>
  </nav>

  <!-- CONTENIDO -->
  <main class="content">

    <!-- AFINADOR -->
    <section id="afinador" class="tab active">
      <h1>🎵 Afinador</h1>
      
      <div class="afinador-container">
        <label for="targetNote">Nota objetivo:</label>
        <select id="targetNote">
          <option value="C2">Do 2 (C2)</option>
          <option value="C#2">Do# 2 (C#2)</option>
          <option value="D2">Re 2 (D2)</option>
          <option value="D#2">Re# 2 (D#2)</option>
          <option value="E2" selected>Mi 2 (E2)</option>
          <option value="F2">Fa 2 (F2)</option>
          <option value="F#2">Fa# 2 (F#2)</option>
          <option value="G2">Sol 2 (G2)</option>
          <option value="G#2">Sol# 2 (G#2)</option>
          <option value="A2">La 2 (A2)</option>
          <option value="A#2">La# 2 (A#2)</option>
          <option value="B2">Si 2 (B2)</option>

          <option value="C3">Do 3 (C3)</option>
          <option value="C#3">Do# 3 (C#3)</option>
          <option value="D3">Re 3 (D3)</option>
          <option value="D#3">Re# 3 (D#3)</option>
          <option value="E3">Mi 3 (E3)</option>
          <option value="F3">Fa 3 (F3)</option>
          <option value="F#3">Fa# 3 (F#3)</option>
          <option value="G3">Sol 3 (G3)</option>
          <option value="G#3">Sol# 3 (G#3)</option>
          <option value="A3">La 3 (A3)</option>
          <option value="A#3">La# 3 (A#3)</option>
          <option value="B3">Si 3 (B3)</option>

          <option value="C4">Do 4 (C4)</option>
          <option value="C#4">Do# 4 (C#4)</option>
          <option value="D4">Re 4 (D4)</option>
          <option value="D#4">Re# 4 (D#4)</option>
          <option value="E4">Mi 4 (E4)</option>
          <option value="F4">Fa 4 (F4)</option>
          <option value="F#4">Fa# 4 (F#4)</option>
          <option value="G4">Sol 4 (G4)</option>
          <option value="G#4">Sol# 4 (G#4)</option>
          <option value="A4">La 4 (A4)</option>
          <option value="A#4">La# 4 (A#4)</option>
          <option value="B4">Si 4 (B4)</option>
        </select>
        <button id="recordBtn" type="button">Iniciar</button>
        <h2 id="noteDisplay">--</h2>
        <div id="guideText"></div>
      </div>
    </section>
    
    <!-- ESTUDIO -->
    <section id="estudio" class="tab">
      <h1>🎧 Estudio</h1>

      <div class="card">
        <h3>Pista musical</h3>
        <div class="studio-controls">
          <button id="refreshStudioTrackListBtn" type="button">🔄 Actualizar lista</button>
        </div>
        <select id="studioTrackSelect">
          <option value="">Selecciona una pista desde Biblioteca</option>
        </select>
        <div class="studio-controls" style="margin-bottom: 15px;">
          <button id="loadStudioTrackBtn" type="button">📥 Cargar pista seleccionada</button>
        </div>
        <p style="color: var(--text-muted); font-size: 14px;">O sube un archivo nuevo desde tu PC:</p>
        <input type="file" id="audioFile" accept="audio/*">
        <audio id="player" controls></audio>
        <div class="studio-controls">
          <button id="playTrackBtn" type="button">▶️ Reproducir</button>
          <button id="pauseTrackBtn" type="button">⏸️ Pausar</button>
          <button id="stopTrackBtn" type="button">⏹️ Detener</button>
        </div>
      </div>

      <div class="card">
        <h3>Voz desde Biblioteca</h3>
        <div class="studio-controls">
          <button id="refreshVoiceListBtn" type="button">🔄 Actualizar lista</button>
        </div>
        <select id="voiceLibrarySelect">
          <option value="">Selecciona una voz guardada</option>
        </select>
        <div class="studio-controls">
          <button id="loadSelectedVoiceBtn" type="button">📥 Cargar voz seleccionada</button>
          <button id="transcribeVoiceBtn" type="button">📝 Transcribir con Whisper</button>
        </div>
        <audio id="selectedVoicePlayer" controls></audio>
        <p id="selectedVoiceStatus">Estado: ninguna voz seleccionada</p>
      </div>

      <div class="card">
        <h3>Grabación de voz</h3>
        <div class="studio-controls">
          <button id="startStudioRecBtn" type="button">🎙️ Grabar voz</button>
          <button id="stopStudioRecBtn" type="button">🛑 Detener grabación</button>
          <button id="redoStudioRecBtn" type="button">🔁 Volver a grabar</button>
          <button id="saveStudioRecBtn" type="button">💾 Guardar grabación</button>
        </div>
        <p id="studioStatus">Estado: sin grabación</p>
        
        <div id="duoIndicator" style="display: none; margin-top: 15px; padding: 15px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border);">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: var(--accent);">🎤🎤 Modo Dúo Activo</p>
          <div style="display: flex; gap: 20px;">
            <div style="flex: 1;">
              <small>Mic 1:</small>
              <!-- CORRECCIÓN VISUAL: Añadimos fondo amarillo nativo para emparejar con el tema -->
              <div class="mic-level-bar"><div id="duoMic1Level" class="mic-level-fill" style="background:#facc15; box-shadow:0 0 10px rgba(250,204,21,0.5);"></div></div>
            </div>
            <div style="flex: 1;">
              <small>Mic 2:</small>
              <!-- CORRECCIÓN VISUAL: Añadimos fondo cian nativo para emparejar con el tema -->
              <div class="mic-level-bar"><div id="duoMic2Level" class="mic-level-fill" style="background:#06b6d4; box-shadow:0 0 10px rgba(6,182,212,0.5);"></div></div>
            </div>
          </div>
        </div>
        <audio id="voicePlayer" controls></audio>
      </div>

      <div class="card">
        <h3>Letra</h3>
        <textarea id="lyricsText" rows="6" placeholder="Aquí vamos a mostrar o pegar la letra de la canción..."></textarea>
        <div class="studio-controls">
          <button id="applyCorrectedLyricsBtn" type="button">✅ Aplicar letra corregida</button>
        </div>

        <!-- SINCRONIZACIÓN MANUAL CON TAPS -->
        <div id="tapSyncSection" style="margin-top: 15px; padding: 15px; background: linear-gradient(135deg, #1e3a5f, #1e293b); border-radius: 8px; border: 2px solid #3b82f6;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h4 style="margin: 0; color: #60a5fa;">🎯 Sincronización Manual</h4>
            <button id="toggleAutoScrollBtn" type="button" style="background: #f59e0b; font-size: 12px; padding: 5px 10px;">🔒 Auto-scroll: ON</button>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 15px;">
            Escucha el audio y presiona TAP (o ESPACIO) cada vez que empiece una nueva línea.
          </p>
          <div class="studio-controls" style="margin-bottom: 15px;">
            <button id="startTapSyncBtn" type="button" style="background: #3b82f6; color: white;">▶️ Iniciar Sincronización</button>
            <button id="cancelTapSyncBtn" type="button" style="background: #6b7280; display: none;">❌ Cancelar</button>
          </div>
          
          <div id="tapSyncActive" style="display: none;">
            <div style="text-align: center; padding: 20px; background: var(--bg-main); border-radius: 8px; margin-bottom: 15px;">
              <p style="font-size: 14px; color: var(--text-muted); margin: 0 0 10px 0;">Línea actual:</p>
              <p id="tapCurrentLine" style="font-size: 20px; font-weight: bold; color: #facc15; margin: 0 0 15px 0;">---</p>
              <p style="font-size: 14px; color: var(--text-muted); margin: 0 0 5px 0;">Progreso:</p>
              <p id="tapProgress" style="font-size: 16px; color: #22c55e; margin: 0;">0 / 0 líneas</p>
            </div>
            <button id="tapBeatBtn" type="button" style="width: 100%; padding: 30px; font-size: 24px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border-radius: 12px;">
              🎵 TAP (o presiona ESPACIO)
            </button>
            <p style="font-size: 12px; color: var(--text-muted); text-align: center; margin-top: 10px;">
              ⌨️ También puedes usar la barra espaciadora
            </p>
          </div>

  
  <!-- Resultado de Taps -->
  <div id="tapSyncResult" style="display: none; margin-top: 15px; padding: 15px; background: #14532d; border-radius: 8px; border: 1px solid #22c55e;">
    <p style="color: #22c55e; font-weight: bold; margin: 0 0 10px 0;">✅ ¡Sincronización completada!</p>
    <div class="studio-controls">
      <button id="applyTapSyncBtn" type="button" style="background: #22c55e;">✅ Aplicar tiempos</button>
      <button id="redoTapSyncBtn" type="button" style="background: #f59e0b;">🔄 Repetir</button>
    </div>
  </div>
</div>

  <!-- CORRECCIÓN ID MONITOR: Cambiado a miniMonitorTextArea para acoplarse con la carga de la biblioteca -->
  <div id=".textContent" class="karaoke-lyrics">
    <p class="karaoke-placeholder">Aquí se mostrará la letra sincronizada.</p>
  </div>
</div>
</section>

<!-- BIBLIOTECA -->
<section id="biblioteca" class="tab">
  <h1>📁 Biblioteca</h1>

  <!-- BOTONES DE CARPETA -->
  <div class="folder-controls">
    <button class="folder-btn" type="button" onclick="renderLibrary('todos')">📂 Todos</button>
    <button class="folder-btn" type="button" onclick="renderLibrary('pista')">🎵 Pistas</button>
    <button class="folder-btn" type="button" onclick="renderLibrary('voz')">🎙️ Voces</button>
    <button class="folder-btn" type="button" onclick="renderLibrary('grabación')">💾 Grabaciones</button>
    <button class="folder-btn" type="button" onclick="renderLibrary('karaoke')">🎤 Karaoke</button>
    <button class="folder-btn" type="button" onclick="renderLibrary('ultrastar_txt')">📝 Texto UltraStar</button>
  </div>

  <!-- SUBIR ARCHIVOS DESDE PC -->
  <div class="card">
    <h3>📤 Subir archivo desde PC</h3>
    <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 15px;">
      Sube pistas, voces o letras sincronizadas. Los archivos se guardan en tu navegador.
    </p>

    <div class="settings-group">
      <label for="libraryFileInput">Archivo (Audio o Letra TXT)</label>
      <input type="file" id="libraryFileInput" accept="audio/*,.txt">
    </div>

    <div class="settings-group">
      <label for="libraryFileType">Tipo</label>
      <select id="libraryFileType">
        <option value="pista">🎵 Pista instrumental</option>
        <option value="voz">🎙️ Voz</option>
        <!-- CORRECCIÓN ORTOGRÁFICA: Cambiado a "grabación" con acento para coincidir con IndexedDB -->
        <option value="grabación">💾 Grabación / Mezcla</option>
        <option value="ultrastar_txt">📝 Texto UltraStar (.txt)</option>
      </select>
    </div>

    <div class="settings-group">
      <label for="libraryFileName">Nombre personalizado (opcional)</label>
      <input type="text" id="libraryFileName" placeholder="Ej. Bohemian Rhapsody - Pista">
    </div>

    <div class="studio-controls">
      <button id="saveLibraryFileBtn" type="button" style="background: #3b82f6; color: white;">💾 Guardar en Biblioteca</button>
    </div>
  </div>

  <div class="card">
    <h3>Archivos guardados</h3>
    <div id="libraryList"></div>
  </div>
</section>

<!-- KARAOKE LIBRARY -->
<section id="karaokeLibrary" class="tab">
  <h1>🎵 Karaoke Library</h1>

  <div class="card">
    <h3>Lista de Canciones</h3>
    <p style="color: var(--text-muted); margin-bottom: 15px;">Selecciona una canción para cargarla en el monitor de Karaoke.</p>

    <div style="overflow-x: auto;">
      <table id="karaokeLibraryTable" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background: var(--bg-main); border-bottom: 2px solid var(--border);">
            <th style="padding: 12px; text-align: left; color: var(--text-muted);">#</th>
            <th style="padding: 12px; text-align: left; color: var(--text-muted);">Título</th>
            <th style="padding: 12px; text-align: left; color: var(--text-muted);">Artista</th>
            <th style="padding: 12px; text-align: left; color: var(--text-muted);">Fuente</th>
            <th style="padding: 12px; text-align: center; color: var(--text-muted);">Acciones</th>
          </tr>
        </thead>
        <tbody id="karaokeLibraryTableBody">
          <tr>
            <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">Cargando canciones...</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="studio-controls" style="margin-top: 15px;">
      <button id="refreshKaraokeLibraryBtn" type="button" style="background: #6b7280;">🔄 Actualizar Lista</button>
    </div>
  </div>
</section>

<!-- KARAOKE -->
<section id="karaoke" class="tab">
  <h1>🎤 Karaoke</h1>

  <!-- MONITOR DE PENTAGRAMA -->
  <div class="card" style="background: #1a1a1a; padding: 0;">
    <canvas id="karaokeCanvas" width="900" height="300" style="width: 100%; display: block; border-radius: 8px;"></canvas>
  </div>

  <!-- MONITOR DE LETRAS -->
  <div class="card">
    <h3>Letra Sincronizada</h3>
    <div id="miniMonitorTextArea" class="karaoke-lyrics" style="min-height: 200px; max-height: 400px; overflow-y: auto; padding: 15px; background: var(--bg-main); border-radius: 8px; font-size: 18px; line-height: 1.8;"></div>
  </div>

  <!-- INFO DE CANCIÓN CARGADA -->
  <div class="card" id="loadedKaraokeSongInfo" style="display: none;">
    <h3>Canción Cargada</h3>
    <p id="loadedKaraokeSongTitle" style="font-size: 18px; font-weight: bold; color: var(--accent);"></p>
    <p id="loadedKaraokeSongArtist" style="color: var(--text-muted);"></p>
    <audio id="karaokeTrack" controls style="margin-top: 15px; width: 100%;"></audio>
  </div>

  <!-- Paso 1: Grabación -->
  <div class="card">
    <h3>1. Grabación</h3>
    <p id="karaokeStatus" style="color: var(--text-muted); margin-bottom: 15px;">Estado: Esperando canción...</p>
    
    <div id="karaokeDuoIndicator" style="display: none; margin-bottom: 15px; padding: 15px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border);">
      <p style="margin: 0 0 10px 0; font-weight: bold; color: var(--accent);">🎤🎤 Modo Dúo Activo</p>
      <div style="display: flex; gap: 20px;">
        <div style="flex: 1;">
          <small>Mic 1:</small>
          <div class="mic-level-bar" style="background: rgba(255,255,255,0.1); height: 12px; border-radius: 4px; overflow: hidden; position: relative;">
            <div id="karaokeDuoMic1Level" class="mic-level-fill" style="width: 0%; height: 100%; background: #facc15; transition: width 0.05s ease;"></div>
          </div>
        </div>
        <div style="flex: 1;">
          <small>Mic 2:</small>
          <div class="mic-level-bar" style="background: rgba(255,255,255,0.1); height: 12px; border-radius: 4px; overflow: hidden; position: relative;">
            <div id="karaokeDuoMic2Level" class="mic-level-fill" style="width: 0%; height: 100%; background: #06b6d4; transition: width 0.05s ease;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="studio-controls">
      <button id="karaokeStartBtn" class="btn-danger" type="button">🎙️ Iniciar Grabación</button>
      <button id="karaokeStopBtn" type="button">⏹️ Detener</button>
      <button id="karaokeRestartBtn" type="button">🔄 Volver a intentar</button>
    </div>

    <h4 style="margin-top: 20px;">Tu voz grabada:</h4>
    <audio id="karaokeVoicePlayer" controls></audio>
  </div>

  <!-- Paso 2: Mezcla -->
  <div class="card">
    <h3>2. Mezcla Final</h3>
    <p style="color: var(--text-muted); margin-bottom: 15px;">Une la pista instrumental con tu voz en un solo archivo de audio.</p>

    <div class="studio-controls">
      <button id="karaokeMixBtn" type="button" style="background: #a855f7; color: white;">🎧 Mezclar Pista + Voz</button>
    </div>

    <div id="karaokeMixResult" style="margin-top: 15px;"></div>
  </div>
</section>

<!-- SPLITTER -->
<section id="splitter" class="tab">
      <h1>✂️ Splitter IA</h1>

      <div class="card">
        <h3>Separar Voz e Instrumental</h3>
        <p style="color: var(--text-muted); margin-bottom: 20px;">
          Sube una canción. La Inteligencia Artificial la separará y la guardará en tu Biblioteca.
        </p>

        <input type="file" id="splitterFile" accept="audio/*">
        
        <div class="studio-controls">
          <button id="splitBtn" type="button" style="background: #3b82f6; color: white;">✨ Separar Audio con IA</button>
        </div>

        <div id="splitterStatusBox" style="margin-top: 20px; padding: 15px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border); display: none;">
          <h4 id="splitterStatusText" style="color: var(--accent); margin: 0;">Iniciando IA...</h4>
          <p id="splitterDetailText" style="color: var(--text-muted); font-size: 14px;">Esto puede tardar un poco.</p>
        </div>
      </div>
    </section>

    <!-- CONFIG -->
    <section id="config" class="tab">
      <h1>⚙️ Configuración</h1>
      
      <div class="card">
        <h3>Preferencias de la App</h3>
        <p style="color: var(--text-muted); margin-bottom: 20px;">Los cambios se guardan automáticamente.</p>
        
        <div class="settings-group">
          <label for="userVoiceType">👤 Tipo de voz</label>
          <select id="userVoiceType">
            <option value="grave">Grave</option>
            <option value="media">Media</option>
            <option value="aguda">Aguda</option>
            <option value="todas">Todas</option>
          </select>
        </div>
        
        <div class="settings-group">
          <label for="micCount">🔊 Cantidad de micrófonos</label>
          <select id="micCount">
            <option value="1">1 Micrófono (Solo)</option>
            <option value="2">2 Micrófonos (Dúo)</option>
          </select>
        </div>
        
        <!-- CONTROL DEL HARDWARE - MICRÓFONO 1 -->
        <div class="settings-group">
          <button type="button" id="refreshMicsBtn" style="background: #6b7280;">🔄 Actualizar lista de micrófonos</button>
        </div>
        <div class="settings-group">
          <label for="mic1Select">🎙️ Micrófono Principal (Cantante 1)</label>
          <select id="mic1Select">
            <option value="">Cargando dispositivos...</option>
          </select>
          <div class="studio-controls">
            <button type="button" id="testMic1Btn" style="background: #3b82f6;">🔊 Probar Mic 1</button>
          </div>
          <div id="mic1Level" class="mic-level-bar"><div class="mic-level-fill"></div></div>
        </div>

        <!-- CORRECCIÓN COMPLEMENTARIA: Añadimos la maquetación física del Micrófono 2 para el modo Dúo -->
        <div id="mic2Group" class="settings-group" style="display: none;">
          <label for="mic2Select">🎙️ Micrófono Secundario (Cantante 2)</label>
          <select id="mic2Select">
            <option value="">Cargando dispositivos...</option>
          </select>
          <div class="studio-controls">
            <button type="button" id="testMic2Btn" style="background: #3b82f6;">🔊 Probar Mic 2</button>
          </div>
          <div id="mic2Level" class="mic-level-bar"><div class="mic-level-fill"></div></div>
        </div>
        
        <div class="settings-group">
          <label for="micSensitivity">🎚️ Sensibilidad del Micrófono (Umbral)</label>
          <input type="range" id="micSensitivity" min="0.000" max="0.010" step="0.001" value="0.015">
          <small style="color: var(--text-muted);">Más alto = filtra más ruido de fondo.</small>
        </div>
        
        <div class="settings-group">
          <label for="difficultyLevel">📊 Dificultad para el Afinador</label>
          <select id="difficultyLevel">
            <option value="facil">Fácil</option>
            <option value="medio">Medio</option>
            <option value="dificil">Difícil</option>
            <option value="experto">Experto</option>
          </select>
        </div>
        
        <div class="settings-group">
          <label for="pentagramDifficulty">📊 Dificultad para el Pentagrama</label>
          <select id="pentagramDifficulty">
            <option value="facil">Fácil</option>
            <option value="medio">Medio</option>
            <option value="dificil">Difícil</option>
          </select>
        </div>

        <!-- CORRECCIÓN INTERFAZ SELECTOR ESCENARIOS: Vinculamos los nombres y el nuevo Retrowave -->
        <div class="settings-group" style="margin-top: 20px;">
          <label for="karaokeThemeSelect">🎨 Escenario de Karaoke (Tema Visual)</label>
          <select id="karaokeThemeSelect">
            <option value="theme-clasico">Clásico (Slate)</option>
            <option value="theme-moderno">Moderno (Neón Azul)</option>
            <option value="theme-disco">Disco (Magenta/Rosa)</option>
            <option value="theme-acustico">Acústico (Madera Cálida)</option>
            <option value="theme-fiesta">Fiesta (Luces Animadas)</option>
            <option value="theme-retrowave">Retrowave (Synthwave Ochentero) 🚀</option>
          </select>
        </div>

        <!-- CORRECCIÓN INTERFAZ TEMAS GLOBALES: Añadimos el conmutador data-theme -->
        <div class="settings-group">
          <label for="appTheme">🎨 Tema Global de la Interfaz</label>
          <select id="appTheme">
            <option value="oscuro">Oscuro (Por defecto)</option>
            <option value="claro">Claro</option>
            <option value="rock">Rock Metal (Rojo/Piedra)</option>
            <option value="pop">Pop Star (Rosa/Pastel)</option>
            <option value="neon">Cyber Neon (Púrpura Eléctrico)</option>
            <option value="naturaleza">Naturaleza (Verde Bosque)</option>
          </select>
        </div>

        <!-- NOTIFICACIÓN DE GUARDADO EXIGIDA POR JAVASCRIPT -->
        <div id="saveNotification" class="save-notification">💾 Configuración guardada en el almacenamiento local...</div>
      </div>
    </section>

  </main> <!-- Cierre del contenedor de contenido central -->
</div> <!-- Cierre de la envoltura global de la app -->

<!-- INYECCIÓN UNIFICADA DE SCRIPTS DE MOTOR DE AUDIO (Mantenemos tu script principal) -->
<script src="script.js"></script>
</body>
</html>


css

/* 1. Add the Cursive Font (Requires Google Fonts import at top of CSS) */
@import url("https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap");

/* ==========================================
   VARIABLES (ESCALABLE)
========================================== */
:root {
  --bg-main: #0f172a;
  --bg-sidebar: #1e293b;
  --bg-card: #1e293b;

  --text-main: #ffffff;
  --text-muted: #94a3b8;

  --accent: #22c55e;
  --accent-hover: #16a34a;

  --danger: #ef4444;
  --border: #334155;
}

/* ==========================================
   RESET BÁSICO
========================================== */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: var(--bg-main);
  color: var(--text-main);
}

/* ==========================================
   LAYOUT
========================================== */
.app {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 220px;
  background: var(--bg-sidebar);
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar h2 {
  margin-bottom: 20px;
}

/* ==========================================
   BOTONES SIDEBAR
========================================== */
.sidebar button {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: 0.2s;
}

.sidebar button:hover,
.sidebar button.active {
  background: var(--border);
  color: var(--text-main);
}

/* ==========================================
   CONTENIDO
========================================== */

.content {
  flex: 1;
  padding: 12px 20px; /* Reducido para ahorrar espacio vertical */
  overflow-y: auto;
}

.tab {
  display: none;
}

.tab.active {
  display: block;
}

/* ==========================================
   TARJETAS
========================================== */
.card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 12px 16px; /* Reducido de 20px a 12px vertical */
  margin-bottom: 10px; /* Reducido de 20px a 10px para juntar más los bloques */
}

/* ==========================================
   BOTONES GENERALES
========================================== */
/* 2. Global Section Styles (Font, Size, Spacing) */
#tapSyncSection,
#lyricsText {
  font-family: "Dancing Script", cursive !important;
  font-size: 14px;
  letter-spacing: 2px;
}

/* 3. Neon Pop Animation Definition */
@keyframes neon-pop {
  0% {
    transform: scale(1);
    text-shadow: none;
  }
  50% {
    transform: scale(1.15);
    color: #39ff14; /* Neon Green */
    text-shadow: 0 0 10px #39ff14, 0 0 20px #39ff14;
  }
  100% {
    transform: scale(1.1);
  }
}


/* 5. Light Blue Aligned Button */
#tapBeatBtn {
  width: 100%;
  background: linear-gradient(to bottom, #00d4ff, #00a3ff);
  color: white;
  padding: 15px;
  font-size: 18px;
  margin: 10px 0;
  box-sizing: border-box;
  border: none;
  border-radius: 8px;
}

button {
  border: none;
  border-radius: 8px;
  padding: 6px 14px; /* Reducido de 10px a 6px de alto */
  font-weight: bold;
  cursor: pointer;
  transition: 0.2s;
}

select,
input[type="text"] {
  width: 100%;
  background: var(--bg-main);
  color: var(--text-main);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
}
#selectedVoiceStatus {
  margin-top: 15px;
  color: var(--text-muted);
  font-weight: bold;
}

button:hover {
  background: var(--accent-hover);
}

/* Botón peligro */
.btn-danger {
  background: var(--danger);
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

/* ==========================================
   INPUTS
========================================== */
input[type="file"],
input[type="password"],
input[type="text"],
select,
textarea {
  width: 100%;
  background: var(--bg-main);
  color: var(--text-main);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
}

textarea {
  width: 100%;
  background: var(--bg-main);
  color: var(--text-main);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  resize: vertical;
  margin-top: 10px;
  font-family: Arial, sans-serif;
}

input::placeholder {
  color: var(--text-muted);
}

/* ==========================================
   AFINADOR
========================================== */
#noteDisplay {
  font-size: 120px;
  font-weight: 900;
  margin: 0;
  transition: color 0.3s ease;
}

#guideText {
  font-size: 32px;
  margin: 20px 0;
  font-weight: bold;
  text-align: center;
}

#recordBtn {
  background-color: #22c55e !important;
  color: white !important;
  padding: 10px 40px;
  font-size: 18px;
}

#recordBtn.recording {
  background-color: #ef4444 !important;
}

.afinador-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  height: 60vh;
  text-align: center;
}

.success {
  color: #22c55e !important;
  transform: scale(1.2);
}

/* ==========================================
   ESTUDIO Y BIBLIOTECA
========================================== */
.studio-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 15px;
}

#studioStatus,
#selectedVoiceStatus {
  margin-top: 15px;
  color: var(--text-muted);
  font-weight: bold;
}

#libraryList div,
.library-item {
  background: var(--bg-card);
  padding: 16px;
  border-radius: 10px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
}

.karaoke-placeholder {
  color: var(--text-muted);
  margin: 0;
}

/* ==========================================
   MONITORES DE LETRAS (ESTUDIO)
========================================= */
.karaoke-lyrics {
  margin-top: 20px;
  padding: 20px;
  background: var(--bg-main);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-height: 320px;
  overflow-y: auto;
  /* CORRECCIÓN SCROLL FLUIDO: Sincroniza el suavizado del auto-scroll */
  scroll-behavior: smooth;
}

.karaoke-line {
  font-size: 22px;
  line-height: 1.6;
  margin: 14px 0;
  text-align: center;
  color: var(--text-muted);
  transition: all 0.25s ease;
}

.karaoke-line.active {
  color: #22c55e;
  font-weight: bold;
  transform: scale(1.03);
}

.karaoke-line.past {
  color: #64748b;
}

/* ==========================================
   MONITOR REPRODUCTOR ULTRASTAR (KARAOKE)
========================================== */
.karaoke-live-line {
  font-size: 26px;
  color: #475569;
  margin: 10px 0;
  text-align: center;
  transition: all 0.2s ease;
  opacity: 0.5;
}

.karaoke-live-line.active {
  color: #22c55e; /* Verde neón brillante */
  font-size: 34px;
  font-weight: 900;
  opacity: 1;
  text-shadow: 0 0 10px rgba(34, 197, 94, 0.6); /* Brillo neón */
  transform: scale(1.1);
}

.karaoke-live-line.past {
  color: #ffffff;
  opacity: 0.8;
  font-size: 26px;
}

.karaoke-line.upcoming {
  color: var(--text-muted);
}

/* ==========================================
   RESALTADO DE SÍLABAS / PALABRAS
========================================== */
.karaoke-word,
.karaoke-live-word {
  display: inline-block;
  color: inherit;
  transition: color 0.1s ease, transform 0.1s ease, text-shadow 0.1s ease;
  white-space: pre-wrap;
}

/* Palabra activa sonando en este preciso instante */
.karaoke-word.active-word,
.karaoke-live-word.active-word {
  color: #facc15 !important;
  font-weight: 800;
  text-shadow: 0 0 12px rgba(250, 204, 21, 0.8);
  transform: scale(1.08);
}

/* CORRECCIÓN: Las palabras que ya pasaron toman un gris limpio translúcido 
   para no confundirse con el verde de la línea activa general */
.karaoke-word.past-word,
.karaoke-live-word.past-word {
  color: rgba(255, 255, 255, 0.4) !important;
  text-shadow: none;
  transform: scale(1);
}

/* ==========================================
   🔥 COMPONENTE: ESCENARIOS / TEMAS VISUALES INTERACTIVOS
========================================== */
/* Tema Clásico (Por defecto) */
.karaoke-lyrics.theme-clasico {
  background: #0f172a;
  border-color: #334155;
}

/* Tema Moderno (Cian Neón) */
.karaoke-lyrics.theme-moderno {
  background: #082f49 !important;
  border-color: #06b6d4 !important;
  box-shadow: 0 0 15px rgba(6, 182, 212, 0.3);
}
.karaoke-lyrics.theme-moderno .karaoke-live-line.active,
.karaoke-lyrics.theme-moderno .karaoke-line.active {
  color: #06b6d4 !important;
  text-shadow: 0 0 10px rgba(6, 182, 212, 0.6);
}

/* Tema Disco / Fiesta (Magenta Vibrante) */
.karaoke-lyrics.theme-disco {
  background: #2e1065 !important;
  border-color: #db2777 !important;
  box-shadow: 0 0 15px rgba(219, 39, 119, 0.3);
}
.karaoke-lyrics.theme-disco .karaoke-live-line.active,
.karaoke-lyrics.theme-disco .karaoke-line.active {
  color: #db2777 !important;
  text-shadow: 0 0 10px rgba(219, 39, 119, 0.6);
}

/* Tema Acústico (Madera Cálida) */
.karaoke-lyrics.theme-acustico {
  background: #451a03 !important;
  border-color: #b45309 !important;
}
.karaoke-lyrics.theme-acustico .karaoke-live-line.active,
.karaoke-lyrics.theme-acustico .karaoke-line.active {
  color: #fcd34d !important;
  text-shadow: none;
}

/* Tema Fiesta Animada (Fondo manejado por JS, texto eléctrico) */
.karaoke-lyrics.theme-fiesta .karaoke-live-line.active,
.karaoke-lyrics.theme-fiesta .karaoke-line.active {
  color: #ff007f !important;
  text-shadow: 0 0 12px #ff007f;
}

/* NUEVA CARACTERÍSTICA: Tema Retrowave (Synthwave ochentero) */
.karaoke-lyrics.theme-retrowave {
  background: #1e0b36 !important;
  border-color: #ff007f !important;
  box-shadow: 0 0 20px rgba(255, 0, 127, 0.4);
}

.karaoke-lyrics.theme-retrowave .karaoke-live-line.active,
.karaoke-lyrics.theme-retrowave .karaoke-line.active {
  color: #39ff14 !important; /* Verde Cyberpunk */
  text-shadow: 0 0 10px #39ff14, 0 0 20px #ff007f;
}
.karaoke-lyrics.theme-retrowave .active-word {
  color: #ff007f !important;
  text-shadow: 0 0 8px #ff007f;
}

/* ==========================================
   DESPLEGABLES Y CONFIGURACIÓN
========================================== */
.contenido-desplegable.oculto {
  display: none !important;
}

.flecha {
  display: inline-block;
  transition: transform 0.2s ease;
}

.flecha.rotada {
  transform: rotate(90deg);
}

.settings-group {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
}

.settings-group label {
  font-weight: bold;
  margin-bottom: 10px;
  color: var(--text-main);
  font-size: 16px;
}

.save-notification {
  color: var(--accent);
  font-weight: bold;
  opacity: 0;
  transition: opacity 0.3s ease;
  margin-top: 15px;
  font-size: 14px;
}

.save-notification.show {
  opacity: 1;
}

/* ==========================================
   SCROLL PERSONALIZADO
========================================== */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 10px;
}

#studioStatus {
  margin-top: 15px;
  color: var(--text-muted);
  font-weight: bold;
}

.library-item {
  background: var(--bg-main);
  border: 1px solid var(--border);
  padding: 15px;
  border-radius: 10px;
  margin-bottom: 10px;
  transition: box-shadow 0.3s ease;
}

#tapCurrentLine {
  font-size: 24px !important;
  font-family: Arial, sans-serif !important;
  color: #ff4500 !important; /* Orange-Red */
  text-shadow: 0 0 10px #ff4500 !important; /* Pop effect */
  letter-spacing: 1px !important;
  font-weight: bold !important;
  text-transform: none !important;
}

/* Tap effect for the current line */
#tapCurrentLine:active {
  color: #ff4500 !important;
  text-shadow: 0 0 20px #ff4500 !important;
  transform: scale(0.98) !important;
}

/* ==========================================
   ESCENARIOS DE KARAOKE (TEMAS VISUALES - CORREGIDO)
========================================== */
/* CORRECCIÓN: Apuntamos al ID real de tu monitor unificado "#karaokeLiveLyrics" o ".karaoke-lyrics" */
/* Nota: karaokeLiveLyrics no existe en HTML, usando miniMonitorTextArea */
#miniMonitorTextArea.theme-clasico,
.karaoke-lyrics.theme-clasico {
  background: transparent;
}

/* Moderno (Neón Azul) */
#miniMonitorTextArea.theme-moderno,
.karaoke-lyrics.theme-moderno {
  background: #082f49 !important;
  border: 2px solid #06b6d4 !important;
  box-shadow: 0 0 15px rgba(6, 182, 212, 0.3);
}
#karaokeLiveLyrics.theme-moderno .karaoke-live-line.active,
.karaoke-lyrics.theme-moderno .karaoke-line.active {
  color: #06b6d4 !important;
  text-shadow: 0 0 15px #06b6d4 !important;
}

/* Disco (Gradiente Vibrante) */
#miniMonitorTextArea.theme-disco,
.karaoke-lyrics.theme-disco {
  background: linear-gradient(45deg, #4c1d95, #be185d) !important;
  border: 2px solid #db2777 !important;
  box-shadow: 0 0 15px rgba(219, 39, 119, 0.4);
}
#karaokeLiveLyrics.theme-disco .karaoke-live-line.active,
.karaoke-lyrics.theme-disco .karaoke-line.active {
  color: #facc15 !important;
  text-shadow: 0 0 12px #facc15 !important;
  font-size: 34px !important;
}

/* Acústico (Madera Cálida) */
#miniMonitorTextArea.theme-acustico,
.karaoke-lyrics.theme-acustico {
  background: #451a03 !important;
  border: 2px solid #78350f !important;
}
#karaokeLiveLyrics.theme-acustico .karaoke-live-line.active,
.karaoke-lyrics.theme-acustico .karaoke-line.active {
  color: #fcd34d !important;
  text-shadow: none !important;
  font-style: italic;
}

/* Fiesta Animada (Fondo con luces locas) */
#miniMonitorTextArea.theme-fiesta,
.karaoke-lyrics.theme-fiesta {
  border: 2px solid #ff007f !important;
  /* CORRECCIÓN: Enlazamos el ciclo de animaciones de luces neón */
  animation: luces-fiesta 4s infinite alternate !important;
}
#karaokeLiveLyrics.theme-fiesta .karaoke-live-line.active,
.karaoke-lyrics.theme-fiesta .karaoke-line.active {
  color: #ff007f !important;
  text-shadow: 0 0 20px #ff007f !important;
}

/* NUEVA CARACTERÍSTICA: Escenario Retrowave (Synthwave Ochentero) */
#miniMonitorTextArea.theme-retrowave,
.karaoke-lyrics.theme-retrowave {
  background: #1e0b36 !important;
  border: 2px solid #ff007f !important;
  box-shadow: 0 0 20px rgba(255, 0, 127, 0.5);
}
#karaokeLiveLyrics.theme-retrowave .karaoke-live-line.active,
.karaoke-lyrics.theme-retrowave .karaoke-line.active {
  color: #39ff14 !important; /* Verde Cyberpunk */
  text-shadow: 0 0 10px #39ff14, 0 0 20px #ff007f !important;
}

/* CORRECCIÓN ANIMACIÓN FIESTA: Estructuramos los fotogramas para simular luces de discoteca */
@keyframes luces-fiesta {
  0% {
    background-color: #1e1b4b;
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
  }
  50% {
    background-color: #311042;
    box-shadow: 0 0 20px rgba(236, 72, 153, 0.4);
  }
  100% {
    background-color: #062f22;
    box-shadow: 0 0 15px rgba(34, 197, 94, 0.3);
  }
}

/* ==========================================
   MODO CELULAR (RESPONSIVE DESIGN)
========================================== */
@media (max-width: 768px) {
  .app {
    flex-direction: column-reverse;
    height: 100vh;
    overflow: hidden;
  }

  .sidebar {
    width: 100%;
    height: 70px;
    padding: 5px 10px;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--border);
    overflow-x: auto;
    white-space: nowrap;
  }

  .sidebar h2 {
    display: none;
  }

  .sidebar button {
    text-align: center;
    padding: 10px;
    font-size: 14px;
    flex: 1;
    margin: 0 2px;
  }

  .content {
    height: calc(100vh - 70px);
    padding: 15px;
  }

  #noteDisplay {
    font-size: 80px;
  }
}

/* ==========================================
   SISTEMA DE CARPETAS DE BIBLIOTECA
========================================== */
.folder-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  justify-content: center;
  background: var(--bg-main);
  padding: 15px;
  border-radius: 12px;
  border: 1px solid var(--border);
}

.folder-btn {
  padding: 10px 20px;
  /* CORRECCIÓN VARIABLES: Mapeamos a tus nombres reales de variables globales */
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-main);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
}

.folder-btn:hover,
.folder-btn.active {
  background: var(--accent);
  color: black;
  border-color: var(--accent-hover);
  transform: translateY(-2px);
}

.library-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.delete-library-btn {
  background: #444;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  transition: background 0.2s ease;
}

.delete-library-btn:hover {
  background: #ef4444;
}

#karaokeCanvas {
  background: linear-gradient(180deg, #0a0a0a 0%, #1a1a2e 100%);
  display: block;
  height: 420px; /* Aumentado de 300px a 420px para ocupar más de la mitad */
  width: 100%;
  border-radius: 8px;
  border: 2px solid #3b82f6;
}

/* ==========================================
   SISTEMA DE TEMAS GLOBALES
========================================== */
/* TEMA CLARO */
[data-theme="claro"] {
  --bg-main: #f1f5f9;
  --bg-sidebar: #e2e8f0;
  --bg-card: #ffffff;
  --text-main: #1e293b;
  --text-muted: #64748b;
  --accent: #22c55e;
  --accent-hover: #16a34a;
  --danger: #ef4444;
  --border: #cbd5e1;
}
[data-theme="claro"] .sidebar button {
  color: #475569;
}
[data-theme="claro"] .sidebar button:hover,
[data-theme="claro"] .sidebar button.active {
  background: #cbd5e1;
  color: #1e293b;
}
[data-theme="claro"] audio {
  filter: invert(0);
}

/* TEMA ROCK */
[data-theme="rock"] {
  --bg-main: #1c1917;
  --bg-sidebar: #292524;
  --bg-card: #292524;
  --text-main: #fafaf9;
  --text-muted: #a8a29e;
  --accent: #dc2626;
  --accent-hover: #b91c1c;
  --danger: #f97316;
  --border: #44403c;
}
[data-theme="rock"] .sidebar h2 {
  color: #dc2626;
}
[data-theme="rock"] button {
  background: #dc2626;
  color: white;
}
[data-theme="rock"] button:hover {
  background: #b91c1c;
}

/* TEMA POP */
[data-theme="pop"] {
  --bg-main: #fdf2f8;
  --bg-sidebar: #fbcfe8;
  --bg-card: #fce7f3;
  --text-main: #831843;
  --text-muted: #9d174d;
  --accent: #ec4899;
  --accent-hover: #db2777;
  --danger: #f43f5e;
  --border: #f9a8d4;
}
[data-theme="pop"] .sidebar h2 {
  color: #be185d;
}
[data-theme="pop"] .sidebar button {
  color: #9d174d;
}
[data-theme="pop"] .sidebar button:hover,
[data-theme="pop"] .sidebar button.active {
  background: #f9a8d4;
  color: #831843;
}
[data-theme="pop"] button {
  background: #ec4899;
  color: white;
}
[data-theme="pop"] button:hover {
  background: #db2777;
}

/* TEMA NEÓN */
[data-theme="neon"] {
  --bg-main: #0a0a0a;
  --bg-sidebar: #18181b;
  --bg-card: #18181b;
  --text-main: #e4e4e7;
  --text-muted: #a1a1aa;
  --accent: #a855f7;
  --accent-hover: #9333ea;
  --danger: #f43f5e;
  --border: #3f3f46;
}
[data-theme="neon"] .sidebar h2 {
  color: #a855f7;
  text-shadow: 0 0 10px #a855f7, 0 0 20px #a855f7;
}
[data-theme="neon"] button {
  background: #a855f7;
  color: white;
  box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
}
[data-theme="neon"] button:hover {
  background: #9333ea;
  box-shadow: 0 0 20px rgba(168, 85, 247, 0.8);
}
[data-theme="neon"] .card {
  border: 1px solid #a855f7;
  box-shadow: 0 0 15px rgba(168, 85, 247, 0.2);
}

/* TEMA NATURALEZA */
[data-theme="naturaleza"] {
  --bg-main: #14532d;
  --bg-sidebar: #166534;
  --bg-card: #15803d;
  --text-main: #f0fdf4;
  --text-muted: #bbf7d0;
  --accent: #84cc16;
  --accent-hover: #65a30d;
  --danger: #f97316;
  --border: #22c55e;
}
[data-theme="naturaleza"] .sidebar h2 {
  color: #84cc16;
}
[data-theme="naturaleza"] button {
  background: #84cc16;
  color: #14532d;
}
[data-theme="naturaleza"] button:hover {
  background: #65a30d;
}
[data-theme="naturaleza"] .sidebar button {
  color: #bbf7d0;
}
[data-theme="naturaleza"] .sidebar button:hover,
[data-theme="naturaleza"] .sidebar button.active {
  background: #22c55e;
  color: #14532d;
}
/* ==========================================
   VÚMETROS DE HARDWARE DE MICRÓFONOS
========================================== */
.mic-level-bar {
  position: relative;
  width: 100%;
  height: 12px;
  background: rgba(255, 255, 255, 0.1) !important;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 6px;
}

.mic-level-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    #22c55e,
    #84cc16,
    #facc15,
    #f97316,
    #ef4444
  );
  border-radius: 6px;
  transition: width 0.05s ease-out;
}

.mic-level-fill.active {
  animation: pulse-mic 0.3s ease-in-out infinite alternate;
}

@keyframes pulse-mic {
  from {
    opacity: 0.8;
  }
  to {
    opacity: 1;
  }
}

#mic2Group {
  border-top: 1px dashed var(--border);
  padding-top: 20px;
  margin-top: 10px;
}

/* ==========================================
   CATÁLOGO DE KARAOKE Y PLAYLISTS
========================================== */
.catalog-item,
.my-karaoke-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background: var(--bg-main);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.catalog-item:hover,
.my-karaoke-item:hover {
  border-color: var(--accent);
  transform: translateX(5px);
}

.catalog-item-info,
.my-karaoke-item-info {
  flex: 1;
}

.catalog-item-title,
.my-karaoke-item-title {
  font-weight: bold;
  color: var(--text-main);
  margin: 0 0 4px 0;
}

.catalog-item-artist,
.my-karaoke-item-artist {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.catalog-item-actions,
.my-karaoke-item-actions {
  display: flex;
  gap: 8px;
}

.catalog-item-actions button,
.my-karaoke-item-actions button {
  padding: 8px 15px;
  font-size: 13px;
}

/* Modales e Inputs de carga */
#ultrastarModal .settings-group {
  margin-bottom: 15px;
}

#ultrastarModal input[type="file"] {
  margin-top: 8px;
}

/* ==========================================
   BARRAS DE VOLUMEN MODO DÚO (INTEGRADO VISUAL)
========================================== */
/* CORRECCIÓN: Usamos especificidad avanzada para que convivan en armonía
   las barras fijas del Karaoke con el vúmetro multicolor del test de hardware */

/* Color personalizado y sombreado exclusivo mediante su ID */
#karaokeDuoMic1Level {
  background: #facc15 !important;
  box-shadow: 0 0 10px rgba(250, 204, 21, 0.6);
}

#karaokeDuoMic2Level {
  background: #06b6d4 !important;
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.6);
}

/* Color destacado para saber qué carpeta de la biblioteca está abierta */
.folder-btn.active {
  background-color: #3b82f6 !important;
  color: #ffffff !important;
  border: 1px solid #22c55e !important;
  font-weight: bold;
  transform: scale(1.03);
}

/* ====================================================================
   🎨 TEMA GLOBAL ORIGINAL: RETRO WAVE / CYBERPUNK (ANIMADO)
   ==================================================================== */
/* CORRECCIÓN INTERFAZ: Adaptamos el selector para que responda al 
   sistema de atributos data-theme unificado de tu motor JS */
[data-theme="retrowave"] {
  --bg-main: #0b001a;
  --bg-sidebar: #1e0936;
  --bg-card: rgba(30, 9, 54, 0.6);
  --text-main: #ffffff;
  --text-muted: #bbf7d0;
  --accent: #ff007f;
  --accent-hover: #db2777;
  --danger: #ef4444;
  --border: #ff007f;
}

[data-theme="retrowave"] body {
  background-color: #0b001a !important;
  background-image: linear-gradient(rgba(255, 0, 128, 0.1) 2px, transparent 2px),
    linear-gradient(90deg, rgba(255, 0, 128, 0.1) 2px, transparent 2px) !important;
  background-size: 40px 40px;
  background-position: center bottom;
  animation: grid-scroll 4s linear infinite !important;
  position: relative;
  overflow-x: hidden;
}

/* El sol brillante ochentero de fondo */
[data-theme="retrowave"] body::before {
  content: "";
  position: absolute;
  bottom: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  height: 300px;
  background: linear-gradient(#ff007f, #facc15);
  border-radius: 50%;
  filter: blur(2px);
  box-shadow: 0 0 60px rgba(255, 0, 127, 0.6);
  opacity: 0.4;
  z-index: -1;
  animation: sun-pulse 3s ease-in-out infinite alternate;
}

/* Estilo para las tarjetas del menú bajo este tema */
[data-theme="retrowave"] .card {
  background: rgba(30, 9, 54, 0.6) !important;
  border: 1px solid #ff007f !important;
  box-shadow: 0 0 15px rgba(255, 0, 127, 0.2);
  backdrop-filter: blur(8px);
}

[data-theme="retrowave"] button {
  background: #ff007f;
  color: white;
  box-shadow: 0 0 10px rgba(255, 0, 127, 0.4);
}

[data-theme="retrowave"] button:hover {
  background: #db2777;
  box-shadow: 0 0 15px rgba(255, 0, 127, 0.7);
}

[data-theme="retrowave"] .sidebar button:hover,
[data-theme="retrowave"] .sidebar button.active {
  background: rgba(255, 0, 127, 0.2);
  color: #ffffff;
  border: 1px solid #ff007f;
}

/* --- ANIMACIONES NATIVAS RETROWAVE --- */
@keyframes grid-scroll {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 0 40px;
  }
}

@keyframes sun-pulse {
  from {
    transform: translateX(-50%) scale(0.95);
    opacity: 0.3;
  }
  to {
    transform: translateX(-50%) scale(1.05);
    opacity: 0.55;
  }
}

/* ==========================================================
   EFECTO PIE DE PÁGINA (MINIMALISTA Y ULTRA-COMPACTO)
   ========================================================== */

/* 1. Volver los títulos diminutos como notas al pie */
.card h1,
.card h2,
.card h3,
.card h4,
.card h5,
.card h6 {
  font-size: 11px !important; /* Tamaño micro de nota al pie */
  font-weight: bold !important;
  text-transform: uppercase; /* En mayúsculas para que sea legible a pesar de ser mini */
  margin: 2px 0 !important;
  color: var(
    --text-muted
  ) !important; /* Color gris suave para que no compita con el karaoke */
}

/* 2. Textos descriptivos aún más pequeños */
.card p,
.card span,
.card div,
.card label {
  font-size: 12px !important; /* Tamaño mínimo legible */
  margin: 1px 0 !important;
  color: rgba(255, 255, 255, 0.4) !important; /* Súper sutil */
}

/* 3. Volver el reproductor de audio una barrita minimalista */
audio {
  height: 24px !important; /* Reduce la altura a la mitad de su tamaño original */
  margin-top: 2px !important;
  margin-bottom: 2px !important;
  opacity: 0.7; /* Lo hace sutil para que se mezcle con el fondo */
  transition: opacity 0.2s;
}
audio:hover {
  opacity: 1; /* Se aclara solo cuando pasas el mouse por encima */
}

/* 4. Reducir la separación interna de los bloques para aplastarlos más */


export default async function handler(req, res) {
  // 💡 1. Configurar cabeceras CORS obligatorias al inicio
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/') || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 💡 2. Responder de inmediato con éxito a la verificación previa (Preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 💡 3. Validar el método permitido posterior
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { audioBase64 } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: "Falta el audio" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Falta configurar OPENAI_API_KEY en el servidor" });
    }

    // Convertir base64 a binario
    const audioBuffer = Buffer.from(audioBase64, "base64");

    // Crear archivo compatible para enviar a OpenAI
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("file", audioBlob, "chunk.wav");
    formData.append("model", "whisper-1");
    formData.append("language", "es");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    const openAIResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const responseText = await openAIResponse.text();

    if (!openAIResponse.ok) {
      console.error("Error de OpenAI:", responseText);
      return res.status(openAIResponse.status).json({
        error: "Error al transcribir en OpenAI",
        detail: responseText
      });
    }

    const data = JSON.parse(responseText);
    return res.status(200).json(data);

  } catch (error) {
    console.error("Error del servidor:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      detail: error.message
    });
  }
}



Voz transcribir

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

    // --- NUEVO: GUARDADO AUTOMÁTICO DEL ARCHIVO ULTRASTAR TXT CORREGIDO ---
    try {
      const vozOriginal = await getLibraryItemById(selectedVoiceId); 
      const nombreBase = vozOriginal ? vozOriginal.name.replace(/🎙️ Voz - |Voz - /g, "") : "Nueva Canción";
      
      const bpmPorDefecto = 120;
      const gapPorDefecto = 0;
      const duracionUnBeat = 60 / (bpmPorDefecto * 4); // Resolución x4 para evitar que se corra el tiempo

      const cabeceraUltraStar = `#TITLE:${nombreBase}\n#ARTIST:Whisper Transcribe\n#BPM:${bpmPorDefecto}\n#GAP:${gapPorDefecto}\n`;
      let lineasCuerpo = [];

      // Mapeamos los segmentos nativos de Whisper a líneas de tiempo estructuradas de UltraStar
      baseTranscriptionSegments.forEach((seg, index) => {
        // Convertimos segundos absolutos a Beats de la rejilla matemática musical
        const startBeat = Math.max(0, Math.floor(seg.start / duracionUnBeat));
        const endBeat = Math.max(startBeat + 1, Math.floor(seg.end / duracionUnBeat));
        const lengthBeats = endBeat - startBeat;
        
        // Pitch por defecto en 0 (Equivale a C4/Do Central) hasta que el usuario use los Taps o cante
        const pitchBase = 0; 
        
        // Asegurar que el texto conserve un espacio si no es una sílaba unida
        const textoLimpio = seg.text ? ` ${seg.text.trim()}` : " ...";

        lineasCuerpo.push(`: ${startBeat} ${lengthBeats} ${pitchBase}${textoLimpio}`);

        // Insertar un corte de línea reglamentario (-) si detectamos pausas naturales o signos de puntuación
        if (seg.text && (seg.text.includes("\n") || seg.text.includes(".") || seg.text.includes(","))) {
          lineasCuerpo.push("-");
        }
      });

      // Añadimos el cierre obligatorio del archivo "E"
      lineasCuerpo.push("E");

      const contenidoFinalTxt = cabeceraUltraStar + lineasCuerpo.join("\n");

      await addLibraryItem({
        name: `UltraStar - ${nombreBase}`,
        type: "ultrastar_txt", 
        audioBlob: null,       
        textoPlano: contenidoFinalTxt, 
        date: new Date().toLocaleString("es-ES"),
        transcription: baseTranscriptionSegments 
      });

      console.log("✅ Archivo estructurado de UltraStar TXT creado con éxito en la Biblioteca");
      await renderLibrary("ultrastar_txt");

    } catch (err) {
      console.error("❌ Error al generar el archivo UltraStar estructurado:", err);
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
