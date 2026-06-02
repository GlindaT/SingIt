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
  const container = $("karaokeLiveLyrics");
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
      const monitor = $("karaokeLiveLyrics");
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
      
    if (typeof loadKaraokeCatalog === "function") loadKaraokeCatalog();
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
          <button type="button" class="load-catalog-btn" data-folder="${song.folder}" data-title="${song.title}" data-artist="${song.artist}" style="background: #22c55e;">▶️ Cantar</button>
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
      
      // CORRECCIÓN AUTOPLAY: Enlazamos la reproducción controlando la promesa nativa del hardware
      track.play()
        .then(() => {
          if (status) status.textContent = `Estado: 🎤 Reproduciendo "${title}". ¡A cantar!`;
          // Encendemos el analizador de Pitch únicamente si la pista arrancó con éxito
          if (typeof startKaraokePitchDetection === "function") startKaraokePitchDetection();
        })
        .catch(err => {
          console.warn("Reproducción automática pausada por el navegador:", err);
          if (status) status.textContent = `Estado: ⏸️ "${title}" cargada. Presiona el botón de iniciar para cantar.`;
        });
    }
    
    // Desplazamiento suave directo al Canvas de entrenamiento
    const canvas = $("karaokeCanvas");
    if (canvas) {
      canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    
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
    const karaokeSongs = await getLibraryItemsByType("karaoke");
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
    // CORRECCIÓN PROTECTORA: Detener bucles y liberar hardware previos antes de inyectar la nueva cancion
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
    $("karaokeStatus").textContent = `Estado: "${title}" cargada. ¡Lista para cantar! 🎤`;
    
    // CORRECCIÓN AUTOPLAY: Evaluamos la promesa nativa del hardware para un arranque fluido
    if (track) {
      track.play()
        .then(() => {
          if (typeof startKaraokePitchDetection === "function") startKaraokePitchDetection();
        })
        .catch(err => console.log("Arranque manual requerido por políticas de privacidad del navegador:", err));
    }

    const canvas = $("karaokeCanvas");
    if (canvas) {
      canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    
  } catch (error) {
    console.error("Error cargando canción:", error);
    alert("❌ Error al cargar la canción");
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
