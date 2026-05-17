// ==========================================
// CONFIG GLOBAL
// ==========================================

const state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
}

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

// CARGAS PROTEGIDAS: Si una falla, no detiene a las demás
  loadKaraokeCatalog().catch(err => console.error("Fallo catálogo:", err));
  loadMyKaraokeSongs().catch(err => console.error("Fallo mis canciones:", err));
  renderLibrary().catch(err => console.error("Fallo render biblioteca:", err));

// ==========================================
// INDEXED DB - BIBLIOTECA
// ==========================================

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("VocalAppDB", 1);

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

async function updateLibraryItem(id, changes) {
  const { error } = await supabaseClient
    .from("library_items")
    .update(changes)
    .eq("id", id);
  
  if (error) {
    throw new Error(error.message || "Error al actualizar en Supabase");
  }
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
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.style.display = 'none';
  });

  const activeTab = document.getElementById(tabId);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.style.display = 'block';
    
    // Eliminamos o comentamos la línea que no existe
    // if (tabId === 'karaoke') {
    //    ajustarTamanoCanvas(); 
    // }
  }
  
  window.scrollTo(0, 0);
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
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);
  
  setTimeout(() => {
    detectPitch();
  }, 300);
}


function stopAfinador() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
}

function detectPitch() {
  if (!state.isRecording || !analyser) return;

  // 1. Obtener datos del Analyser
  analyser.getFloatTimeDomainData(pitchBuffer);
  const pitch = autoCorrelate(pitchBuffer, audioContext.sampleRate);

  const display = $("noteDisplay");
  const guide = $("guideText");
  const targetNoteEl = $("targetNote");
  const targetNote = targetNoteEl ? targetNoteEl.value : "E2";
  if (display && guide) {
    if (pitch !== -1) {
      const noteFull = getNoteFromFrequency(pitch);
      const targetFreq = getNoteFrequency(targetNote);
      const cents = 1200 * Math.log2(pitch / targetFreq);
      
      display.textContent = noteFull;

      const dificultad = localStorage.getItem("vocalApp_difficulty") || "medio";
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
      guide.style.color = "#6b7280"; // Gris neutro
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

  if (rms < 0.01) return -1;

  // Usamos el valor guardado
  const umbral = parseFloat(localStorage.getItem("vocalApp_sensitivity")) || 0.01;

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
let selectedVoiceBlob = null;
let selectedVoiceId = null;


// ==========================================
// ESTUDIO
// ==========================================
function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  studioTrackFileName = file.name;
  
  // Liberar la memoria del audio anterior si existía uno
  if ($("player").src && $("player").src.startsWith("blob:")) {
    URL.revokeObjectURL($("player").src);
  }
  
  const url = URL.createObjectURL(file);
  $("player").src = url;
  $("studioStatus").textContent = `Estado: pista cargada (${file.name})`;
  
  // Asegúrate de asignar el evento cuando se selecciona un archivo
  const voiceFileInput = document.getElementById("voiceFileInput");
  if (voiceFileInput) {
    voiceFileInput.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      // Cargar en el reproductor de voz de la interfaz (voicePlayer)
      const voicePlayer = document.getElementById("voicePlayer"); // Asegúrate que este sea el ID de tu audio
      if (voicePlayer) {
        if (voicePlayer.src && voicePlayer.src.startsWith("blob:")) {
          URL.revokeObjectURL(voicePlayer.src);
        }
        voicePlayer.src = URL.createObjectURL(file);
      }
      // Guardar referencia para que el botón "Transcribir con Whisper" la encuentre
      selectedVoiceBlob = file; 
      document.getElementById("selectedVoiceStatus").textContent = `Estado: Voz subida (${file.name})`;
    });
  }
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
    studioStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints1
    });
    
    let finalStream = studioStream;
    
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
      studioStream2 = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints2
      });
      
      // Crear contexto de audio para mezclar
      duoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source1 = duoAudioContext.createMediaStreamSource(studioStream);
      const source2 = duoAudioContext.createMediaStreamSource(studioStream2);
      
      // Crear analizadores para visualización
      duoAnalyser1 = duoAudioContext.createAnalyser();
      duoAnalyser2 = duoAudioContext.createAnalyser();
      duoAnalyser1.fftSize = 256;
      duoAnalyser2.fftSize = 256;
      
      // Crear mezclador
      const merger = duoAudioContext.createChannelMerger(2);
      const destination = duoAudioContext.createMediaStreamDestination();
      
      // Conectar: fuentes -> analizadores -> mezclador -> destino
      source1.connect(duoAnalyser1);
      source2.connect(duoAnalyser2);
      duoAnalyser1.connect(merger, 0, 0);
      duoAnalyser2.connect(merger, 0, 1);
      merger.connect(destination);
      
      finalStream = destination.stream;
      
      // Mostrar indicador de dúo
      const duoIndicator = $("duoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "block";
      }
      // Iniciar visualización de niveles
      startDuoLevelMonitor();
    }
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {};
    studioMediaRecorder = new MediaRecorder(finalStream, options);
    studioMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        studioChunks.push(event.data);
      }
    };
    studioMediaRecorder.onstop = () => {
      studioRecordedBlob = new Blob(studioChunks, { type: "audio/webm" });
      const audioURL = URL.createObjectURL(studioRecordedBlob);
      $("voicePlayer").src = audioURL;
      $("studioStatus").textContent = "Estado: grabación lista para escuchar o guardar";
      
      // Ocultar indicador dúo
      const duoIndicator = $("duoIndicator");
      if (duoIndicator) {
        duoIndicator.style.display = "none";
      }
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
    
    // CAMBIO: Enviamos 'blob' en lugar de 'audioBlob' para que coincida con la definición de la función
    await saveLibraryItemToSupabase({
      name: options.name || "Audio",
      type: options.type || "audio",
      blob: blob, 
      date: new Date().toLocaleString("es-ES"),
      transcription: options.transcription || []
    });
    await renderLibrary();
  } catch (error) {
    console.error(error);
    alert("❌ No se pudo guardar en la nube");
  }
}

async function renderLibrary(filter = "todos") {
  const container = $("libraryList");
  if (!container) return;
  
  container.innerHTML = "<p>Cargando archivos...</p>";
  
  try {
    let library = await getAllLibraryItemsFromSupabase();
    let filteredItems = library;
    if (filter !== "todos") {
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
        
        div.innerHTML = `
        <p><strong>${item.name}</strong></p>
        <small>Tipo: ${item.type.toUpperCase()} | ${new Date(item.created_at).toLocaleString("es-ES")}</small>
        <audio controls src="${item.file_url}" style="width:100%; margin: 10px 0;"></audio>
        <button type="button" data-id="${item.id}" class="delete-library-btn" style="background:#e11d48;">🗑️ Eliminar</button>
        `;
        container.appendChild(div);
      });
    }
    
    document.querySelectorAll(".delete-library-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        await deleteLibraryItem(id);
        renderLibrary(filter);
      });
    });
    
    await loadVoiceOptionsInStudio();
    await loadTrackOptionsInStudio();
    await loadTrackOptionsInKaraoke();
  
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>❌ Error al cargar la biblioteca.</p>";
  }
}

async function deleteLibraryItem(id) {
  try {
    await deleteLibraryItemFromSupabase(id);
    await renderLibrary();
    alert("✅ Archivo eliminado");
  } catch (error) {
    console.error(error);
    alert("❌ Error al eliminar el archivo");
  }
}

async function saveManualFileToLibrary() {
  const fileInput = $("libraryFileInput");
  const typeSelect = $("libraryFileType");
  const nameInput = $("libraryFileName");
  const file = fileInput?.files[0];
  
  if (!file) return alert("⚠️ Selecciona un archivo.");
  try {
    const progress = $("uploadProgress");
    if (progress) progress.style.display = "block";
    // Usamos la función de Supabase para que sea consistente con renderLibrary
    await saveLibraryItemToSupabase({
      name: nameInput.value.trim() || file.name,
      type: typeSelect.value,
      blob: file, // Nombre de propiedad corregido para que coincida con la definición
      transcription: []
    });
    
    alert("✅ ¡Archivo guardado en la nube!");
    await renderLibrary('todos');
  } catch (error) {
    console.error(error);
    alert("❌ Error al guardar: " + error.message);
  } finally {
    // --- CAMBIO AQUÍ: Verificamos de nuevo ---
    const progress = $("uploadProgress");
    if (progress) progress.style.display = "none";
    fileInput.value = "";
  }
}

async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect");
  if (!select) return;
  
  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  try {
    const tracks = await getLibraryItemsByTypeFromSupabase("pista");
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
      option.textContent = `${item.name}`;
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
  
  const selectedId = select.value;
  
  if (!selectedId) {
    alert("⚠️ Selecciona una pista");
    return;
  }
  
  try {
    const item = await getLibraryItemByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró la pista");
      return;
    }
    studioTrackFileName = item.name;
    player.src = item.file_url;
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
    const voces = await getLibraryItemsByTypeFromSupabase("voz");
    const grabaciones = await getLibraryItemsByTypeFromSupabase("grabacion");
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
      option.textContent = `${item.name} (${new Date(item.created_at).toLocaleString("es-ES")})`;
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
  const selectedId = select.value;
  if (!selectedId) {
    alert("⚠️ Selecciona una voz");
    return;
  }
  try {
    const item = await getLibraryItemByIdFromSupabase(selectedId);
    if (!item) {
      alert("⚠️ No se encontró el archivo");
      return;
    }
    const response = await fetch(item.file_url);
    selectedVoiceBlob = await response.blob();
    selectedVoiceId = item.id;
    
    player.src = item.file_url;
    status.textContent = `Estado: voz seleccionada -> ${item.name}`;
    
    if (Array.isArray(item.transcription) && item.transcription.length > 0) {
      baseTranscriptionSegments = item.transcription.map(seg =>
        buildWordTimingFromSegment(seg)
    );
    transcriptionSegments = [...baseTranscriptionSegments];
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

async function uploadFileToSupabase(fileOrBlob, fileName, mimeType = "application/octet-stream") {
  const safeName = `${Date.now()}_${fileName.replace(/\s+/g, "_")}`;
  const filePath = safeName;
  const { error: uploadError } = await supabaseClient.storage
    .from("library")
    .upload(filePath, fileOrBlob, {
      contentType: mimeType,
      upsert: false
    });
  if (uploadError) {
    throw uploadError;
  }
  const { data } = supabaseClient.storage
    .from("library")
    .getPublicUrl(filePath);
  return {
    filePath,
    fileUrl: data.publicUrl
  };
}

async function saveLibraryItemToSupabase({ name, type, blob, transcription = [], metadata = {} }) {
  const mimeType = blob.type || "application/octet-stream";
  const extension = mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("mpeg")
    ? "mp3"
    : mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("ogg")
    ? "ogg"
    : "bin"
  const fileName = `${name}.${extension}`;
  const { filePath, fileUrl } = await uploadFileToSupabase(blob, fileName, mimeType);
  const { error } = await supabaseClient
    .from("library_items")
    .insert([
      {
        name,
        type,
        file_path: filePath,
        file_url: fileUrl,
        mime_type: mimeType,
        transcription,
        metadata
      }
    ]);
  if (error) {
    throw error;
  }
}

async function getAllLibraryItemsFromSupabase() {
  const { data, error } = await supabaseClient
    .from("library_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data || [];
}

async function getLibraryItemsByTypeFromSupabase(type) {
  const { data, error } = await supabaseClient
    .from("library_items")
    .select("*")
    .eq("type", type)
    .order("created_at", { ascending: false });
  if (error) {
    throw error;
  }
  return data || [];
}

async function getLibraryItemByIdFromSupabase(id) {
  const { data, error } = await supabaseClient
    .from("library_items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw error;
  }
  return data;
}

async function deleteLibraryItemFromSupabase(id) {
  // primero buscamos el item para saber qué archivo borrar
  const item = await getLibraryItemByIdFromSupabase(id);
  if (item?.file_path) {
    const { error: storageError } = await supabaseClient.storage
      .from("library")
      .remove([item.file_path]);
    if (storageError) {
      console.warn("No se pudo borrar el archivo del storage:", storageError.message);
    }
  }
  const { error } = await supabaseClient
    .from("library_items")
    .delete()
    .eq("id", id);
  if (error) {
    throw error;
  }
}

// ==========================================
// TRANSCRIPCIÓN CON TÉCNICA DE CHUNKING
// ==========================================
async function downsampleAudioBuffer(buffer, targetSampleRate = 16000) {
  const offlineCtx = new OfflineAudioContext(1, 
  // Forzamos a 1 solo canal (Mono)
  Math.ceil(buffer.duration * targetSampleRate),
  targetSampleRate
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  return await offlineCtx.startRendering();
}

async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) {
    alert("⚠️ Primero selecciona y carga una voz desde Biblioteca");
    return;
  }
  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");
  
  try {
    if (status) status.textContent = "Estado: Preparando audio...";
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await selectedVoiceBlob.arrayBuffer();
    
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (decodeError) {
      throw new Error("El formato de audio no es compatible o está corrupto.");
    }
    
    const CHUNK_SECONDS = 25;
    const totalSamples = audioBuffer.length;
      
    // IMPORTANTE: El sampleRate original sirve para calcular dónde cortar
    const originalSampleRate = audioBuffer.sampleRate; 
    const samplesPerChunk = CHUNK_SECONDS * originalSampleRate;

    let fullSegments = [];
    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      const chunkNumber = Math.floor(start / samplesPerChunk) + 1;
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);
      
      if (status) {
        status.textContent = `Estado: Procesando parte ${chunkNumber} de ${totalChunks}...`;
      }
      
      // --- PASO 1: Extraer el trozo original ---
      // Creamos un buffer temporal para este trozo para poder "adelgazarlo"
      const chunkDuration = (end - start) / originalSampleRate;
      const tempBuffer = audioCtx.createBuffer(audioBuffer.numberOfChannels, end - start, originalSampleRate);
      
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        tempBuffer.copyToChannel(audioBuffer.getChannelData(channel).subarray(start, end), channel);
      }

      // --- PASO 2: ADELGAZAR EL AUDIO (Downsample a 16kHz y Mono) ---
      // Esto es lo que evita el error 413
      const lightBuffer = await downsampleAudioBuffer(tempBuffer, 16000);

      // --- PASO 3: Convertir el buffer ligero a WAV ---
      // Nota: Usamos 0 y lightBuffer.length porque es un buffer nuevo
      const wavBlob = audioBufferToWav(lightBuffer, 0, lightBuffer.length);
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
      const palabrasProhibidas = ["Amara", "Subtítulos", "subtítulos", "Almorzo", "Suscribete", "comunidad"];
      const timeOffset = start / originalSampleRate; // El offset se basa en el tiempo original
      
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

    // --- RESTO DEL CÓDIGO (Guardado y Renderizado) ---
    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);
    renderKaraokeLyrics(transcriptionSegments);
    cargarLetrasEnMonitor();
    
    if (lyricsText) {
      lyricsText.value = transcriptionSegments.map(line => line.text).join("\n");
    }
    
    if (selectedVoiceId) {
      try {
        await updateLibraryItem(selectedVoiceId, {
          transcription: baseTranscriptionSegments 
        });
        console.log("✅ Transcripción guardada en Biblioteca");
      } catch (err) {
        console.error("❌ Error guardando transcripción en BD:", err);
      }
    }

    if (status) {
      status.textContent = "Estado: Transcripción completada y guardada ✅";
    }
  } catch (error) {
    console.error(error);
    alert("❌ Error al transcribir: " + error.message);
    if (status) status.textContent = "Estado: Error en la transcripción";
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

// Variable global para cachear las líneas
let cachedKaraokeLines = [];

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
    // ¡AQUÍ ESTÁ LA CLAVE! Guardamos la referencia para no buscarla en cada frame
    cachedKaraokeLines = Array.from(document.querySelectorAll(".karaoke-line"));
}

function updateKaraokeHighlight(currentTime) {
  // Usamos el caché en lugar de volver a consultar el DOM
  const lines = cachedKaraokeLines;
  if (!lines.length) return;

  let activeLine = null;

  lines.forEach((line) => {
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    line.classList.remove("active", "past", "upcoming");

    if (currentTime >= start - 0.1 && currentTime <= end + 0.1) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end + 0.1) { // El margen aquí ayuda a marcar el 'past'
      line.classList.add("past");
    } else {
      line.classList.add("upcoming");
    }

    const words = line.querySelectorAll(".karaoke-word");
    words.forEach((word) => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart - 0.1 && currentTime <= wordEnd + 0.1) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd + 0.1) {
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

  // 1. Liberar memoria si ya había una pista cargada
  const track = $("karaokeTrack");
  if (track.src && track.src.startsWith("blob:")) {
    URL.revokeObjectURL(track.src);
  }

  karaokeSelectedTrackBlob = file;
  karaokeSelectedTrackName = file.name;

  // 2. Usar un Blob con tipo explícito para evitar problemas de caché
  const blob = new Blob([file], { type: 'audio/mpeg' });
  const urlConCacheBuster = new URL(item.file_url);
    urlConCacheBuster.searchParams.append('v', Date.now());
    track.src = urlConCacheBuster.toString();
    
    track.volume = 0.4;
    $("karaokeStatus").textContent = "Estado: Pista lista. ¡Presiona Iniciar Grabación!";
    
    // Limpiamos letras anteriores para que no se mezclen
    transcriptionSegments = [];
    cargarLetrasEnMonitor();
}

async function loadTrackOptionsInKaraoke() {
  const select = $("karaokeTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde tu Biblioteca</option>`;

  try {
    const pistas = await getLibraryItemsByTypeFromSupabase("pista");

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
  const id = select.value;

  if (!id) {
    alert("⚠️ Selecciona una pista de la lista.");
    return;
  }

  try {
    const item = await getLibraryItemByIdFromSupabase(id);
    if (!item) return;

    karaokeSelectedTrackBlob = null;
    karaokeSelectedTrackName = item.name;

    const track = $("karaokeTrack");
    const urlConCacheBuster = new URL(item.file_url);
      urlConCacheBuster.searchParams.append('v', Date.now());
      track.src = urlConCacheBuster.toString();
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

    if (currentTime >= start - 0.1 && currentTime <= end + 0.1) {
      line.classList.add("active");
      activeLine = line;
    } else if (currentTime > end + 0.1) { // El margen aquí ayuda a marcar el 'past'
      line.classList.add("past");
    }

    const words = line.querySelectorAll(".karaoke-live-word");
    words.forEach(word => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);
      word.classList.remove("active-word", "past-word");
      if (currentTime >= wordStart - 0.1 && currentTime <= wordEnd + 0.1) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd + 0.1) {
        word.classList.add("past-word");
      }
    });
  });

  if (activeLine && activeLine !== lastActiveLine && (typeof autoScrollEnabled !== 'undefined' && autoScrollEnabled)) {
    activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
    lastActiveLine = activeLine;
  }
}

// Fíjate que aquí cerramos bien la anterior y empezamos la nueva
async function mixKaraoke() {
  const trackEl = document.getElementById("karaokeTrack");
  const btn = document.getElementById("karaokeMixBtn");
  const resultDiv = document.getElementById("karaokeMixResult");

  if ((!karaokeSelectedTrackBlob && (!trackEl || !trackEl.src)) || !karaokeRecordedBlob) {
    alert("⚠️ Faltan ingredientes: Asegúrate de cargar una pista instrumental y grabar tu voz primero.");
    return;
  }

  try {
    btn.textContent = "🎧 Mezclando audios... ⏳";
    btn.disabled = true;
    resultDiv.innerHTML = "<p style='color: var(--accent);'>Uniendo la pista y tu voz. Esto puede tardar unos segundos...</p>";

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // 1. Cargar ambos audios en paralelo
    const [trackBuffer, voiceBuffer] = await Promise.all([
      fetch(trackEl.src).then(r => r.arrayBuffer()).then(ab => audioCtx.decodeAudioData(ab)),
      karaokeRecordedBlob.arrayBuffer().then(ab => audioCtx.decodeAudioData(ab))
    ]);

    // 2. Crear un buffer para la mezcla (usamos la duración de la pista)
    const duration = Math.max(trackBuffer.duration, voiceBuffer.duration);
    const mixedBuffer = audioCtx.createBuffer(2, duration * audioCtx.sampleRate, audioCtx.sampleRate);

    // 3. Mezclar canales (L y R)
    for (let channel = 0; channel < 2; channel++) {
      const outputData = mixedBuffer.getChannelData(channel);
      
      // Añadir Pista (si es mono, usamos el canal 0 para ambos)
      const trackData = trackBuffer.getChannelData(channel < trackBuffer.numberOfChannels ? channel : 0);
      for (let i = 0; i < trackData.length; i++) outputData[i] += trackData[i];

      // Añadir Voz (ajustar volumen de la voz si quieres, ej: trackData[i] + (voiceData[i] * 1.2))
      const voiceData = voiceBuffer.getChannelData(channel < voiceBuffer.numberOfChannels ? channel : 0);
      for (let i = 0; i < voiceData.length; i++) outputData[i] += voiceData[i];
    }

    // 4. Convertir a WAV (usando tu función audioBufferToWav)
    const mixedBlob = audioBufferToWav(mixedBuffer, 0, mixedBuffer.length);
    const url = URL.createObjectURL(mixedBlob);

    // 5. Mostrar resultado
    resultDiv.innerHTML = `
      <div class="card" style="border: 1px solid var(--accent); margin-top: 15px;">
        <p>✅ ¡Mezcla lista!</p>
        <audio src="${url}" controls style="width: 100%;"></audio>
        <br><br>
        <a href="${url}" download="mi_karaoke.wav" class="btn-primary" style="text-decoration:none; padding: 10px 20px; display:inline-block;">Descargar Mezcla 📥</a>
      </div>
    `;
  } catch (error) {
    console.error("Error en la mezcla:", error);
    alert("❌ No se pudo realizar la mezcla: " + error.message);
  } finally {
    btn.textContent = "🎙️ Mezclar Audios";
    btn.disabled = false;
  }
  try {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const trackArrayBuffer = await trackBlob.arrayBuffer();
    const trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer);
    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer();
    const voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer);
    const renderedBuffer = await offlineCtx.startRendering();

    const offlineCtx = new OfflineAudioContext(
      trackBuffer.numberOfChannels,
      trackBuffer.length,
      trackBuffer.sampleRate
    );
    
    let trackBlob = karaokeSelectedTrackBlob;
    let trackName = karaokeSelectedTrackName || "Karaoke";

    // Si la pista vino desde Supabase o desde una URL remota, la descargamos
    if (!trackBlob && trackEl?.src) {
      const trackResponse = await fetch(trackEl.src);
      if (!trackResponse.ok) {
        throw new Error("No se pudo descargar la pista instrumental");
      }
      trackBlob = await trackResponse.blob();
    }

    if (!trackBlob) {
      throw new Error("No hay pista instrumental disponible para mezclar");
    }

    const outputLength = Math.max(trackBuffer.length, voiceBuffer.length);
    const outputChannels = Math.max(trackBuffer.numberOfChannels, voiceBuffer.numberOfChannels);

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

   
    const finalWavBlob = exportStereoWav(renderedBuffer);
    const finalUrl = URL.createObjectURL(finalWavBlob);
    
    resultDiv.innerHTML = `
      <h4 style="color: #22c55e;">✅ ¡Mezcla completada!</h4>
      <audio controls src="${finalUrl}" style="width: 100%; margin-bottom: 15px; border-radius: 8px;"></audio>
      <div style="display: flex; gap: 10px;">
        <a href="${finalUrl}" download="Mezcla_${trackName || "Karaoke"}.wav" style="flex: 1;">
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
        name: `Mezcla - ${trackName || "Canción"}`,
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
  console.log("🚀 Iniciando separación..."); // <--- ESTO NOS DIRÁ SI EL BOTÓN FUNCIONA
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

  if (statusBox) statusBox.style.display = "block";
  if (statusText) statusText.textContent = "1/4 📦 Subiendo canción...";
  if (detailText) detailText.textContent = "Enviando al casillero temporal seguro...";
  
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
    const secureUrl = directUrl.replace("http://", "https://"); // Fuerza HTTPS
    statusText.textContent = "2/4 🚀 Iniciando Inteligencia Artificial...";
    detailText.textContent = "Despertando al modelo de alta calidad MDX23...";
    
    const startResponse = await fetch("https://vocal-app-seven.vercel.app/api/split", {
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
          console.log("Preparando exportación de audio...");
          const blobPista = exportStereoWav(renderedBuffer);
          console.log("Blob creado:", blobPista);
          
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
    console.log("✅ Separación completada");
  } catch (err) {
    console.error("❌ Error durante la separación:", err); // <--- ESTO NOS DIRÁ SI HAY UN FALLO OCULTO
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
    micCount: "vocalApp_micCount",
    karaokeStage: "vocalApp_stage",
    difficultyLevel: "vocalApp_difficulty",
    userVoiceType: "vocalApp_voiceType",
    appTheme: "vocalApp_theme",
    micSensitivity: "vocalApp_sensitivity"
  };

  Object.entries(settings).forEach(([id, storageKey]) => {
    const el = $(id);
    if (el) {
      // Cargar valor guardado
      const saved = localStorage.getItem(storageKey);
      if (saved) el.value = saved;
      
      const sensInput = $("micSensitivity");
      if (sensInput) {
      // Cargar valor guardado o usar 0.01 por defecto
        sensInput.value = localStorage.getItem("vocalApp_sensitivity") || "0.01";
        sensInput.addEventListener("input", (e) => {
          localStorage.setItem("vocalApp_sensitivity", e.target.value);
        });
      }
      // Escuchar cambios
        const eventType = el.type === 'range' ? 'input' : 'change'; // Usar 'input' para sliders
        el.addEventListener(eventType, (e) => {
          localStorage.setItem(storageKey, e.target.value);
          if (id !== 'micSensitivity') // Opcional: no mostrar notificación en cada milímetro del slider
            showSaveNotification();
          if (id === "appTheme") {
            applyAppTheme(e.target.value);
          }
        });
    }
  });
  
  // Aplicar tema guardado al iniciar
  applyAppTheme(localStorage.getItem("vocalApp_theme") || "oscuro");   
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
      const savedMic1 = localStorage.getItem("vocalApp_mic1");
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
      const savedMic2 = localStorage.getItem("vocalApp_mic2");
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
  const storageKey = micNumber === 1 ? "vocalApp_mic1" : "vocalApp_mic2";

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
  
  const statusElement = document.getElementById("selectedVoiceStatus");

  if (selectedVoiceId) {
    try {
      await updateLibraryItem(selectedVoiceId, {
        transcription: baseTranscriptionSegments
      });
      
      if (statusElement) {
        statusElement.textContent = "Estado: letra corregida aplicada y guardada ✅";
        statusElement.style.color = "#22c55e"; // Verde éxito
      }
    } catch (error) {
      console.error(error);
      if (statusElement) {
        statusElement.textContent = "Estado: letra corregida, error al guardar en BD ❌";
        statusElement.style.color = "#ef4444"; // Rojo error
      }
    }
  } else {
    if (statusElement) {
      statusElement.textContent = "Estado: letra corregida aplicada ✅";
      statusElement.style.color = "#22c55e";
    }
  }
}
// ==========================================
// SINCRONIZACIÓN MANUAL CON TAPS
// ==========================================
function startTapSync() {
  const lyricsText = $("lyricsText");
  const voicePlayer = $("selectedVoicePlayer");
  
  // Verificación de elementos críticos
  const startBtn = $("startTapSyncBtn");
  const cancelBtn = $("cancelTapSyncBtn");
  const activeBox = $("tapSyncActive");
  const resultBox = $("tapSyncResult");

  if (!startBtn) console.error("Falta el botón: startTapSyncBtn");
  if (!cancelBtn) console.error("Falta el botón: cancelTapSyncBtn");
  // ... (añade más si quieres)

  if (!lyricsText || !lyricsText.value.trim()) {
    alert("⚠️ Primero escribe o corrige la letra en el área de texto.");
    return;
  }
  
  if (!voicePlayer || !voicePlayer.src) {
    alert("⚠️ Primero carga una voz desde la Biblioteca.");
    return;
  }
  
  tapSyncLines = lyricsText.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  if (tapSyncLines.length === 0) {
    alert("⚠️ No hay líneas de texto para sincronizar.");
    return;
  }
  
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  tapSyncMode = true;
  
  // Uso seguro de estilos
  if (startBtn) startBtn.style.display = "none";
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  if (activeBox) activeBox.style.display = "block";
  if (resultBox) resultBox.style.display = "none";
  
  updateTapSyncDisplay();
  voicePlayer.currentTime = 0;
  voicePlayer.play().catch(e => console.error("Error al reproducir:", e));
  
  document.addEventListener("keydown", handleTapSyncKeypress);
  console.log("🎯 Sincronización iniciada.");
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

function stopTapSync() {
    tapSyncMode = false; // Desactivamos el modo de grabación de taps
    
    const voicePlayer = $("selectedVoicePlayer");
    if (voicePlayer) {
        voicePlayer.pause();
    }
    
    // Quitamos el evento del teclado para que no siga capturando espacios
    document.removeEventListener("keydown", handleTapSyncKeypress);
    
    console.log("⏹️ Sincronización pausada. Taps guardados hasta ahora:", tapSyncTimestamps.length);
    
    // Opcional: Podrías cambiar el texto del botón a "Continuar" si quisieras
    alert("⏹️ Sincronización detenida. Puedes retomar cuando quieras.");
}

async function applyTapSync() {
  if (tapSyncTimestamps.length === 0 || tapSyncLines.length === 0) {
    alert("⚠️ No hay datos de sincronización.");
    return;
  }
  
  const voicePlayer = $("selectedVoicePlayer");
  const totalDuration = voicePlayer ? voicePlayer.duration : 0;
  const status = $("selectedVoiceStatus");
  
  status.textContent = "Estado: Aplicando tiempos...";
  
  const newSegments = [];
  
  for (let i = 0; i < tapSyncLines.length; i++) {
    const start = tapSyncTimestamps[i];
    // Aseguramos que el end no pase de la duración total
    let end = (i < tapSyncTimestamps.length - 1) ? tapSyncTimestamps[i + 1] : Math.min(start + 3, totalDuration);
    
    newSegments.push(buildWordTimingFromSegment({
      start: start,
      end: end,
      text: tapSyncLines[i]
    }));
  }

  // ¡IMPORTANTE! Guardar los nuevos segmentos en la base de datos
  transcriptionSegments = newSegments;
  baseTranscriptionSegments = [...newSegments];
  
  if (selectedVoiceId) {
    await updateLibraryItem(selectedVoiceId, { transcription: newSegments });
    status.textContent = "Estado: ¡Sincronización guardada con éxito! ✅";
  }

  renderKaraokeLyrics(transcriptionSegments);
  cargarLetrasEnMonitor();
  $("tapSyncResult").style.display = "none";
  $("startTapSyncBtn").style.display = "inline-block";
}

// Asegúrate de tener esta función en tu script.js
function redoTapSync() {
    // 1. Detenemos todo
    const voicePlayer = $("selectedVoicePlayer");
    if (voicePlayer) {
        voicePlayer.pause();
        voicePlayer.currentTime = 0;
    }
    
    // 2. Limpiamos las variables de tiempo
    tapSyncTimestamps = [];
    tapSyncCurrentIndex = 0;
    
    // 3. Reiniciamos la pantalla
    updateTapSyncDisplay();
    
    // 4. Volvemos a empezar el audio
    if (voicePlayer) voicePlayer.play();
    
    console.log("🔄 Sincronización reiniciada desde cero.");
}

// ==========================================
// INIT
// ==========================================

window.addEventListener('DOMContentLoaded', async () => {
  try {
    
    // 1. Inicialización de Datos
    await initDB();
    console.log("Database Ready");
    
    // Definimos la función
    function initKaraokeListeners() {
      const track = $("karaokeTrack");
      if (track) {
        track.addEventListener('seeked', () => {
          drawKaraokeMonitor(track.currentTime, 0);
        });
        track.addEventListener('timeupdate', () => {
          if (typeof syncKaraokeMonitor === "function") {
            syncKaraokeMonitor(track.currentTime);
          }
        });
      }
    }
  
  // ¡AQUÍ ESTÁ LA CLAVE! Llamamos a la función para que se active
  initKaraokeListeners();
  await renderLibrary('todos');
  await loadTrackOptionsInStudio();
  await loadTrackOptionsInKaraoke();
  
  // 2. Temas y Configuración Visual
  function applyKaraokeTheme() {
    const theme = localStorage.getItem("vocalApp_stage") || "clasico";
    const monitor = $("karaokeLiveLyrics");
    if (monitor) {
      monitor.className = "karaoke-lyrics theme-" + theme;
    }
  }
  applyKaraokeTheme();
  
  // 3. Navegación Principal
  const tabs = ["Afinador", "Estudio", "Biblioteca", "Karaoke", "Splitter", "Config"];
  tabs.forEach(tab => {
    safeAdd(`btn${tab}`, "click", () => showTab(tab.toLowerCase()));
  });
  
  // 4. Asignación de Eventos (Botones)
  safeAdd("karaokeStage", "change", (e) => {
    saveSetting("vocalApp_stage", e.target);
  });
  
  // Afinador / Grabación
  safeAdd("recordBtn", "click", toggleRecording);
  
  // Estudio
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
  
  // Sincronización Manual (Tap)
  safeAdd("startTapSyncBtn", "click", startTapSync);
  safeAdd("cancelTapSyncBtn", "click", cancelTapSync);
  safeAdd("tapBeatBtn", "click", recordTap);
  safeAdd("applyTapSyncBtn", "click", applyTapSync);
  safeAdd("redoTapSyncBtn", "click", redoTapSync);
  safeAdd("splitBtn", "click", splitAudio);
  safeAdd("stopTapSyncBtn", "click", stopTapSync);
  
  // Biblioteca y Karaoke
  safeAdd("saveLibraryFileBtn", "click", saveManualFileToLibrary);
  safeAdd("karaokeTrackFile", "change", cargarPistaKaraoke);
  safeAdd("karaokeStartBtn", "click", startKaraokeRecording);
  safeAdd("karaokeStopBtn", "click", stopKaraokeRecording);
  safeAdd("karaokeRestartBtn", "click", restartKaraokeRecording);
  safeAdd("karaokeMixBtn", "click", mixKaraoke);
  safeAdd("refreshKaraokeTrackBtn", "click", loadTrackOptionsInKaraoke);
  safeAdd("loadKaraokeTrackBtn", "click", loadSelectedTrackFromLibraryKaraoke);
  
  // 5. Sincronización de Reproductores (Loop de Dibujo)
  const kTrack = $("karaokeTrack");
  if (kTrack) {
    kTrack.addEventListener("timeupdate", () => {
      const currentTime = kTrack.currentTime;
      // Esto actualiza las letras de texto
      if (typeof syncKaraokeMonitor === "function") syncKaraokeMonitor(currentTime);
      // Esto actualiza el canvas con las notas (frecuencia actual 0 si no se detecta)
    });
  }
  const player = $("player");
  if (player) {
    player.addEventListener("timeupdate", () => {
      if (typeof updateKaraokeHighlight === "function") updateKaraokeHighlight(player.currentTime);
    });
  }
  
  // 6. Micrófonos y Configuración final
  safeAdd("refreshMicsBtn", "click", loadAvailableMics);
  safeAdd("testMic1Btn", "click", () => testMicrophone(1));
  safeAdd("testMic2Btn", "click", () => testMicrophone(2));
  safeAdd("mic1Select", "change", () => saveMicSelection(1));
  safeAdd("mic2Select", "change", () => saveMicSelection(2));
  safeAdd("micCount", "change", toggleMic2Visibility);
  
  // Cargas iniciales
  loadAvailableMics();
  toggleMic2Visibility();
  
} catch (error) {
  console.error("Error en la inicialización:", error);
  }
});

// ==========================================
// MONITOR DE KARAOKE (CANVAS)
// ==========================================

function drawKaraokeMonitor(currentTime, currentFreq) {
    const canvas = $("karaokeCanvas");
    if (!canvas || !transcriptionSegments || transcriptionSegments.length === 0) {
        if (canvas) {
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#666";
            ctx.font = "16px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Sin datos de karaoke", canvas.width / 2, canvas.height / 2);
        }
        return;
    }

    const ctx = canvas.getContext("2d");
    
    // Guardar historial para el rastro de voz
    if (typeof pitchHistory === 'undefined') window.pitchHistory = [];
    pitchHistory.push(currentFreq > 0 ? currentFreq : null);
    if (pitchHistory.length > 60) pitchHistory.shift();
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // --- 1. CONFIGURACIÓN DE VENTANA ---
    const pixelsPerSecond = (canvas.width - 100) / 6; 
    const lineX = 100; // Línea de tiempo actual
    const topMargin = 50;
    const bottomMargin = 100;
    const drawHeight = canvas.height - topMargin - bottomMargin;

    // Escala MIDI dinámica
    const allMidis = transcriptionSegments.map(s => s.midi).filter(m => m > 0);
    const viewMidiMin = (allMidis.length > 0 ? Math.min(...allMidis) : 60) - 5;
    const viewMidiMax = (allMidis.length > 0 ? Math.max(...allMidis) : 72) + 5;
    const midiRange = viewMidiMax - viewMidiMin;

    const midiToY = (m) => {
        const normalized = (viewMidiMax - m) / midiRange;
        return topMargin + (normalized * drawHeight);
    };

    // --- 2. DIBUJAR PENTAGRAMA ---
    ctx.textAlign = "left";
    for (let m = viewMidiMin; m <= viewMidiMax; m++) {
        const y = midiToY(m);
        ctx.strokeStyle = (m % 12 === 0) ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)";
        ctx.beginPath();
        ctx.moveTo(lineX, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // --- 3. DIBUJAR BARRAS DE NOTAS ---
    let currentLyric = "";

    transcriptionSegments.forEach(seg => {
        const x = lineX + (seg.start - currentTime) * pixelsPerSecond;
        const w = (seg.end - seg.start) * pixelsPerSecond;
        const y = midiToY(seg.midi || 60);

        if (x + w < 0 || x > canvas.width) return;

        const isActive = currentTime >= seg.start && currentTime <= seg.end;
        const isPast = currentTime > seg.end;
        if (isActive) currentLyric = seg.text;

        // Lógica de color según acierto
        let isCorrect = false;
        if (isActive && currentFreq > 0) {
            const userMidi = 69 + 12 * Math.log2(currentFreq / 440);
            isCorrect = Math.abs(userMidi - seg.midi) <= 2;
        }

        ctx.fillStyle = isPast ? "#4b5563" : (isCorrect ? "#22c55e" : (isActive ? "#3b82f6" : "rgba(59, 130, 246, 0.4)"));
        
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y - 10, Math.max(w, 5), 20, 5);
        } else {
            ctx.rect(x, y - 10, Math.max(w, 5), 20);
        }
        ctx.fill();

        // Texto de la sílaba
        ctx.fillStyle = isActive ? "white" : "rgba(255,255,255,0.6)";
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.fillText(seg.text, x + w / 2, y - 15);
    });

    // --- 4. DIBUJAR VOZ DEL USUARIO ---
    if (currentFreq > 0) {
        const userMidi = 69 + 12 * Math.log2(currentFreq / 440);
        const userY = midiToY(userMidi);
        
        ctx.beginPath();
        ctx.fillStyle = "#facc15";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#facc15";
        ctx.arc(lineX, userY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // --- 5. LÍNEA DE TIEMPO Y LETRA GRANDE ---
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX, 20);
    ctx.lineTo(lineX, canvas.height - 80);
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.font = "bold 35px Arial";
    ctx.textAlign = "center";
    ctx.fillText(currentLyric.toUpperCase(), canvas.width / 2, canvas.height - 30);
}
// ==========================================
// DETECCIÓN DE PITCH PARA KARAOKE
// ==========================================
async function startKaraokePitchDetection() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
    if (!track) return;

    const currentTime = track.currentTime;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    const pitch = autoCorrelate(buffer, audioCtx.sampleRate);

    // AQUÍ ES DONDE SE DIBUJA CON EL PITCH REAL
    drawKaraokeMonitor(currentTime, pitch);

    if (track && !track.paused && !track.ended) {
        requestAnimationFrame(loop);
    }
}
    
// ==========================================
// CATÁLOGO Y MIS CANCIONES
// ==========================================
const loadKaraokeCatalog = ();
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
        <p style="font-size: 13px;">Crea en Estudio.</p>
      </div>
    `;
  }
}

function parseUltraStarSync(syncContent) {
    if (!syncContent || typeof syncContent !== "string") return [];
    
    const lines = syncContent.split("\n").map(line => line.trim()).filter(Boolean);
    let bpm = 120, gap = 0;
    const noteLines = [];
    
    for (const line of lines) {
        if (line.startsWith("#BPM:")) bpm = parseFloat(line.replace("#BPM:", "")) || 120;
        else if (line.startsWith("#GAP:")) gap = parseInt(line.replace("#GAP:", "")) || 0;
        else if (/^[:*FR]/.test(line)) noteLines.push(line);
    }
    const secondsPerTick = (60 / bpm) / 4;
    const parsedSegments = noteLines.map(line => {
        const match = line.match(/^[:*FR]\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/);
        if (!match) return null;

        const startTick = parseInt(match[1], 10);
        const durationTick = parseInt(match[2], 10);
        const midiValue = parseInt(match[3], 10);
        const text = match[4] || "";

        const start = (gap / 1000) + (startTick * secondsPerTick);
        const end = start + (durationTick * secondsPerTick);
        
        return {
            start, 
            end, 
            text: text.trim(),
            midi: midiValue + 60, // Ajuste típico de UltraStar a MIDI estándar
            pitch: midiValue > 0 ? 440 * Math.pow(2, (midiValue - 69) / 12) : -1
        };
    }).filter(Boolean);

    return parsedSegments;
}

async function loadCatalogSong(folder, title, artist) {
  const status = $("karaokeStatus");
  const track = $("karaokeTrack");
    // 1. Limpieza previa inmediata
    if (status) status.textContent = `Estado: Cargando "${title}"...`;
    
    try {
        // 2. Cargar sincronización (TXT)
        const syncResponse = await fetch(`./karaoke-catalog/${folder}/sync.txt`);
        if (!syncResponse.ok) throw new Error("No se pudo cargar la sincronización");
        
        const syncContent = await syncResponse.text();
        const parsedSegments = parseUltraStarSync(syncContent);
        
        if (!parsedSegments.length) throw new Error("Formato de sincronización no válido");
        // 3. Cargar audio (MP3)
        const audioResponse = await fetch(`./karaoke-catalog/${folder}/audio.mp3`);
        if (!audioResponse.ok) throw new Error("No se pudo cargar el audio");
        
        const audioBlob = await audioResponse.blob();
        // 4. Configurar el reproductor (Manejo de memoria)
        if (track) {
            
            // Liberamos la URL anterior si existía para evitar fugas de memoria
            if (track.src && track.src.startsWith("blob:")) {
                URL.revokeObjectURL(track.src);
            }
            const urlConCacheBuster = new URL(item.file_url);
            urlConCacheBuster.searchParams.append('v', Date.now());
            track.src = urlConCacheBuster.toString();
            track.volume = 0.4;
        }
        // 5. Actualizar estado global
        
        karaokeSelectedTrackBlob = audioBlob;
        karaokeSelectedTrackName = `${title} - ${artist}`;
        transcriptionSegments = parsedSegments;
        baseTranscriptionSegments = [...parsedSegments];
        
        // Reiniciar variables de seguimiento
        currentTime = 0; 
        if (typeof pitchHistory !== 'undefined') pitchHistory = [];
        
        // 6. UI y Feedback
        cargarLetrasEnMonitor();
        
        if (typeof drawKaraokeMonitor === "function") {
            drawKaraokeMonitor(0);
        }
        if (status) {
            status.textContent = `Estado: "${title}" cargada. ¡Lista para cantar! 🎤`;
        }
        
        const canvas = $("karaokeCanvas");
        if (canvas) {
            canvas.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    
    } catch (error) {
        console.error("Error en loadCatalogSong:", error);
        if (status) status.textContent = `Estado: Error al cargar "${title}"`;
        alert(`❌ Error: ${error.message}`);
    }
}

async function loadMyKaraokeSongs() {
  const container = $("myKaraokeList");
  if (!container) return;
  try {
    // Usamos las versiones de Supabase que definimos antes para ser consistentes
    const karaokeSongs = await getLibraryItemsByTypeFromSupabase("karaoke");
    const voces = await getLibraryItemsByTypeFromSupabase("voz");
    
    const vocesConSync = voces.filter(v => v.transcription && v.transcription.length > 0);
    const allSongs = [...karaokeSongs, ...vocesConSync];

    if (allSongs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #6b7280;">
          <p>No tienes canciones listas aún.</p>
          <p style="font-size: 13px;">Sincroniza una en Estudio.</p>
        </div>`;
      return;
    }

    container.innerHTML = "";
    allSongs.forEach(song => {
      const div = document.createElement("div");
      div.className = "my-karaoke-item card"; // Añadí 'card' para consistencia visual
      
      const title = song.metadata?.title || song.name || "Sin título";
      const artist = song.metadata?.artist || "Artista desconocido";

      div.innerHTML = `
        <div class="my-karaoke-item-info">
          <p class="my-karaoke-item-title" style="font-weight:bold;">${title}</p>
          <p class="my-karaoke-item-artist" style="font-size:0.8em; opacity:0.7;">${artist}</p>
        </div>
        <div class="my-karaoke-item-actions" style="display:flex; gap:5px;">
          <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #22c55e; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">▶️ Cantar</button>
          <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">🗑️</button>
        </div>`;
      container.appendChild(div);
    });

    // Eventos corregidos (sin forzar Number)
    container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => loadKaraokeSong(btn.dataset.id));
    });

    container.querySelectorAll(".delete-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Eliminar esta canción?")) {
          await deleteLibraryItemFromSupabase(btn.dataset.id);
          await loadMyKaraokeSongs();
        }
      });
    });
  } catch (error) {
    console.error("Error cargando canciones:", error);
    container.innerHTML = `<p style="color: #ef4444;">Error al cargar biblioteca</p>`;
  }
}

async function loadAudioSecurely(url, element) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        // Revocamos la URL anterior para liberar memoria
        if (element.src.startsWith("blob:")) URL.revokeObjectURL(element.src);
        
        // Creamos una nueva URL interna que NO tiene problemas de caché
        element.src = URL.createObjectURL(blob);
    } catch (err) {
        console.error("Error al cargar audio:", err);
        // Fallback a URL directa si el fetch falla
        element.src = url;
    }
}

async function loadKaraokeSong(id) {
  try {
    const song = await getLibraryItemByIdFromSupabase(id);
    if (!song) return alert("⚠️ Canción no encontrada");

    const track = $("karaokeTrack");
    if (track) {
      // 1. Limpieza de memoria
      if (track.src && track.src.startsWith("blob:")) {
        URL.revokeObjectURL(track.src);
      }

      // 2. Carga segura del audio (evitando el error de caché)
      if (song.file_url) {
        try {
          // Intentamos descargar el archivo y convertirlo a un objeto local (blob)
          const response = await fetch(song.file_url);
          const blob = await response.blob();
          const urlConCacheBuster = new URL(item.file_url);
            urlConCacheBuster.searchParams.append('v', Date.now());
            track.src = urlConCacheBuster.toString();
        } catch (fetchErr) {
            console.error("Error al descargar audio, usando fallback:", fetchErr);
            // Si falla el fetch, intentamos la carga directa como último recurso
            track.src = song.file_url;
        }
      } else if (song.audioBlob) {
          track.src = URL.createObjectURL(song.audioBlob);
      }
        track.volume = 0.4;
    }

    // --- (Aquí sigue el resto de tu código original de letras) ---
    if (Array.isArray(song.transcription) && song.transcription.length > 0) {
        transcriptionSegments = song.transcription; 
        baseTranscriptionSegments = [...song.transcription];
        cargarLetrasEnMonitor();
        const canvas = $("karaokeCanvas");
        if (canvas) drawKaraokeMonitor(0, 0); 
    } else {
        transcriptionSegments = [];
        baseTranscriptionSegments = [];
        cargarLetrasEnMonitor();
    }

    const title = song.metadata?.title || song.name;
    if ($("karaokeStatus")) {
        $("karaokeStatus").textContent = `Estado: "${title}" cargada. ¡A cantar! 🎤`;
    }
    
    const canvas = $("karaokeCanvas");
    if (canvas) canvas.scrollIntoView({ behavior: "smooth", block: "center" });

  } catch (error) {
    console.error("Error cargando canción:", error);
    alert("❌ Error al cargar la canción");
  }
}

function audioBufferToWav(buffer, start, end) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = end - start;
  
  // CORRECCIÓN: El tamaño debe considerar TODOS los canales
  // 44 bytes de cabecera + (muestras * canales * 2 bytes por muestra de 16bit)
  const bytesPerSample = 2;
  const dataLength = length * numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  // Cabecera WAV
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM Lineal
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Escribir datos de audio
  let offset = 44;
  for (let i = start; i < end; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = buffer.getChannelData(channel)[i];
      // Clamp
      sample = Math.max(-1, Math.min(1, sample));
      // Convertir a 16-bit PCM
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      
      // Verificación de seguridad antes de escribir
      if (offset <= wavBuffer.byteLength - 2) {
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
  
function ajustarTamanoCanvas() {
  const canvas = document.getElementById('karaokeCanvas');
  if (!canvas) return;
  
  // Ajusta el ancho interno del canvas al ancho de su contenedor visual
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  
  // Puedes mantener una altura fija o hacerla proporcional
  canvas.height = 450; 
  console.log("Canvas ajustado a:", canvas.width, "x", canvas.height);
}
}
