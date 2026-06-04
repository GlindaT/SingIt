import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById, updateLibraryItem, addLibraryItem, getAllLibraryItems } from './biblioteca.js'; // <-- ASEGÚRATE DE SUMAR "getAllLibraryItems" AQUÍ
import { getNoteFromFrequency } from './afinador.js';

// --- VARIABLES DE ESTADO GLOBALES ENCAPSULADAS EN EL MÓDULO ---
let transcriptionSegments = [];
let baseTranscriptionSegments = [];
let autoScrollEnabled = true;

let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

let studioTrackFileName = null;
let studioTrackBlob = null;
let studioTrackId = null;
let studioSelectedTrackName = "Sin título";
let studioSelectedTrackBlob = null;
let studioSelectedTrackId = null;

let studioChunks = [];
let studioRecordedBlob = null;
let studioMediaRecorder = null;
let studioStream = null;
let studioStream2 = null;

let duoAudioContext = null;
let duoAnalyser1 = null;
let duoAnalyser2 = null;
let duoAnimationId = null;
let currentVolNode1 = null;
let currentVolNode2 = null;

let selectedVoiceBlob = null;
let selectedVoiceId = null;

/**
 * Expone una interfaz asíncrona para que la biblioteca inyecte líricas al cargar un UltraStar externo
 */
export function setTranscriptionSegments(data) {
  baseTranscriptionSegments = data;
  transcriptionSegments = data;
}

/**
 * Gatilla la animación de parpadeo visual sobre los cuadros de control rítmico
 */
export function handleTap() {
  const elements = [document.getElementById('tapCurrentLine'), document.getElementById('tapProgress')];
  elements.forEach(el => {
    if (el) {
      el.classList.remove('tap-active');
      void el.offsetWidth; // Forzar reflow en el motor de renderizado
      el.classList.add('tap-active');
    }
  });
}

/**
 * Filtro de paso alto acoplado a compresor dinámico de picos vocales para el Studio
 */
export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 60;

  const compresor = audioCtx.createDynamicsCompressor();
  compresor.threshold.setValueAtTime(-24, audioCtx.currentTime);
  compresor.knee.setValueAtTime(30, audioCtx.currentTime);
  compresor.ratio.setValueAtTime(4, audioCtx.currentTime);
  compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compresor.release.setValueAtTime(0.25, audioCtx.currentTime);

  const shelfFilter = audioCtx.createBiquadFilter();
  shelfFilter.type = "highshelf";
  shelfFilter.frequency.value = 4000; 
  shelfFilter.gain.value = 2.0; 

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.4; 

  source.connect(highPass);
  highPass.connect(compresor);
  compresor.connect(shelfFilter);
  shelfFilter.connect(gainNode);
  
  return gainNode; 
}

export function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;

  studioTrackFileName = file.name;
  studioTrackBlob = file;
  studioTrackId = null;

  const url = URL.createObjectURL(file);
  const player = $("player");
  if (player) player.src = url;
  
  const status = $("studioStatus");
  if (status) status.textContent = `Estado: pista cargada (${file.name})`;
}

export function playTrack() {
  const player = $("player");
  if (!player || !player.src) { alert("⚠️ Primero sube una pista"); return; }
  player.play();
}

export function pauseTrack() {
  const player = $("player");
  if (player) player.pause();
}

export function stopTrack() {
  const player = $("player");
  if (!player) return;
  player.pause();
  player.currentTime = 0;
  if (typeof window.updateKaraokeHighlight === 'function') window.updateKaraokeHighlight(0);
}

export async function startStudioRecording() {
  try {
    const player = $("player");
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    studioChunks = [];
    studioRecordedBlob = null;
    
    const voicePlayer = $("voicePlayer");
    if (voicePlayer) voicePlayer.src = "";
    
    const status = $("studioStatus");
    if (status) status.textContent = "Estado: preparando grabación...";

    duoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = duoAudioContext.createMediaStreamDestination();

    const select1 = document.getElementById("mic1Select");
    const select2 = document.getElementById("mic2Select");
    const mic1Id = select1 ? select1.value : null;
    const mic2Id = select2 ? select2.value : null;

    const audioConstraints1 = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 };
    if (mic1Id) audioConstraints1.deviceId = { exact: mic1Id };

    studioStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints1});

    const source1 = duoAudioContext.createMediaStreamSource(studioStream);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, source1);

    const volNode1 = duoAudioContext.createGain();
    volNode1.gain.value = 0.75;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; 

    duoAnalyser1 = duoAudioContext.createAnalyser();
    duoAnalyser1.fftSize = 2048;
    volNode1.connect(duoAnalyser1);

    const merger = duoAudioContext.createChannelMerger(2);
    duoAnalyser1.connect(merger, 0, 0);

    if (!isDuo) duoAnalyser1.connect(merger, 0, 1);

    if (isDuo && mic2Id) {
      const audioConstraints2 = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 };
      if (mic2Id) audioConstraints2.deviceId = { exact: mic2Id };
       
      studioStream2 = await navigator.mediaDevices.getUserMedia({audio: audioConstraints2});

      const source2 = duoAudioContext.createMediaStreamSource(studioStream2);
      const mic2Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, source2);

      const volNode2 = duoAudioContext.createGain();
      volNode2.gain.value = 0.75;
      mic2Filtrado.connect(volNode2);
      currentVolNode2 = volNode2; 

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
      const vp = $("voicePlayer");
      if (vp) vp.src = URL.createObjectURL(studioRecordedBlob);
      if (status) status.textContent = "Estado: grabación lista";
      stopDuoLevelMonitor();
    };

    studioMediaRecorder.start();
    
    const mic1Select = $("mic1Select");
    const mic1Name = mic1Select ? mic1Select.options[mic1Select.selectedIndex]?.text : "Predeterminado";
    
    if (status) {
      if (isDuo && mic2Id) {
        const mic2Select = $("mic2Select");
        const mic2Name = mic2Select ? mic2Select.options[mic2Select.selectedIndex]?.text : "Mic 2";
        status.textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name})...`;
      } else {
        status.textContent = `Estado: 🔴 Grabando con ${mic1Name}...`;
      }
    }

    if (player && player.src) {
      player.currentTime = 0;
      player.play();
    }
  } catch (error) {
    console.error(error);
    const status = $("studioStatus");
    if (status) status.textContent = "Estado: error al acceder al micrófono";
    alert("❌ No se pudo acceder al micrófono. Verifica en Configuración.");
  }
}

export function startDuoLevelMonitor() {
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

export function stopDuoLevelMonitor() {
  if (duoAnimationId) {
    cancelAnimationFrame(duoAnimationId);
    duoAnimationId = null;
  }
  const level1 = $("duoMic1Level");
  const level2 = $("duoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

export function stopStudioRecording() {
  if (studioMediaRecorder && studioMediaRecorder.state !== "inactive") studioMediaRecorder.stop();
  if (studioStream) studioStream.getTracks().forEach(track => track.stop());
  if (studioStream2) { studioStream2.getTracks().forEach(track => track.stop()); studioStream2 = null; }
  if (duoAudioContext) { duoAudioContext.close().catch(() => {}); duoAudioContext = null; }

  duoAnalyser1 = null;
  duoAnalyser2 = null;
  stopDuoLevelMonitor();

  const duoIndicator = $("duoIndicator");
  if (duoIndicator) duoIndicator.style.display = "none";
  const player = $("player");
  if (player) player.pause();
}
/**
 * Resetea los búferes locales para descartar la toma actual
 */
export function redoStudioRecording() {
  studioChunks = [];
  studioRecordedBlob = null;
  
  const vp = $("voicePlayer");
  if (vp) vp.src = "";
  
  const status = $("studioStatus");
  if (status) status.textContent = "Estado: grabación eliminada. Lista para volver a grabar.";
}

/**
 * Exporta el audio grabado directamente hacia la base de datos de la Biblioteca
 */
export async function saveStudioRecording() {
  if (!studioRecordedBlob) {
    alert("⚠️ No hay grabación para guardar");
    return;
  }

  const baseName = studioTrackFileName
    ? `Voz - ${studioTrackFileName}`
    : "Grabación de voz";

  try {
    // LLAMADA MODULAR: Guardado directo en IndexedDB usando la función del módulo biblioteca.js
    await addLibraryItem({
      name: baseName,
      type: "voz",
      date: new Date().toISOString(),
      audioBlob: studioRecordedBlob // Sincronizado unificadamente como audioBlob para el CRUD
    });

    const status = $("studioStatus");
    if (status) status.textContent = "Estado: grabación guardada en Biblioteca";
    alert("🚀 ¡Grabación guardada con éxito en tu Biblioteca local!");
  } catch (error) {
    console.error("Error al guardar la grabación en IndexedDB:", error);
    alert("❌ Hubo un error al intentar guardar en la base de datos.");
  }
}

/**
 * Lee la base de datos y llena el selector con las pistas disponibles
 */
export async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;

  try {
    // LLAMADA MODULAR: Consume datos desde el motor de la biblioteca de forma limpia
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
    console.error("Error al cargar opciones de pistas en Estudio:", error);
  }
}

/**
 * Carga la pista seleccionada en el reproductor multimedia principal
 */
export async function loadSelectedTrackFromLibraryStudio() {
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
    // LLAMADA MODULAR: Busca el archivo binario en la base de datos
    const item = await getLibraryItemById(selectedId);

    if (!item) {
      alert("⚠️ No se encontró la pista");
      return;
    }

    // Sincronización exacta de variables locales
    studioTrackFileName = item.name;
    studioTrackBlob = item.audioBlob;
    studioTrackId = item.id;

    studioSelectedTrackName = item.name;
    studioSelectedTrackBlob = item.audioBlob;
    studioSelectedTrackId = item.id;
    
    player.src = URL.createObjectURL(item.audioBlob);
    status.textContent = `Estado: pista cargada desde Biblioteca (${item.name})`;
  } catch (error) {
    console.error("Error al cargar pista seleccionada en el reproductor:", error);
    alert("❌ No se pudo cargar la pista seleccionada");
  }
}
/**
 * Limpia el panel de resultados y reinicia el ciclo de escucha de toques desde cero
 */
export function redoTapSync() {
  const resultBox = $("tapSyncResult");
  if (resultBox) resultBox.style.display = "none";
  startTapSync();
}
export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;

  try {
    // 1. Descargamos TODOS los elementos guardados para evitar que los filtros case-sensitive de IndexedDB oculten archivos
    const todosLosItems = await getAllLibraryItems();

    // 2. Filtramos mediante Javascript convirtiendo el tipo a minúsculas de forma segura
    const merged = todosLosItems.filter(item => {
      if (!item.type) return false;
      const tipoLimpio = item.type.toLowerCase().trim();
      return tipoLimpio === "voz" || tipoLimpio === "grabación" || tipoLimpio === "grabacion";
    });

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
    
    console.log("🎙️ Selector de voces del Estudio actualizado de forma segura.");
  } catch (error) {
    console.error("Error al cargar opciones de voces en Estudio:", error);
  }
}
