let transcriptionSegments = [];
let baseTranscriptionSegments = [];
let autoScrollEnabled = true; // Control de auto-scroll

// Variables para sincronización con Taps
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

// Función para animación visual del Tap
export function handleTap() {
    const elements = [document.getElementById('tapCurrentLine'), document.getElementById('tapProgress')];
    
    elements.forEach(el => {
        if (el) {
            // Remueve la clase para reiniciar la animación
            el.classList.remove('tap-active');
            // Forzar reflow en el navegador para reiniciar la animación
            void el.offsetWidth; 
            // Re-añadir la clase
            el.classList.add('tap-active');
        }
    });
}
export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
    const highPass = audioCtx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 60; // Filtra golpes físicos al micrófono

    const compresor = audioCtx.createDynamicsCompressor();
    compresor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compresor.knee.setValueAtTime(30, audioCtx.currentTime);
    compresor.ratio.setValueAtTime(4, audioCtx.currentTime);
    compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compresor.release.setValueAtTime(0.25, audioCtx.currentTime);

    const shelfFilter = audioCtx.createBiquadFilter();
    shelfFilter.type = "highshelf";
    shelfFilter.frequency.value = 4000; 
    shelfFilter.gain.value = 2.0; // Brillo vocal profesional

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.4; 

    // Conexión secuencial en serie
    source.connect(highPass);
    highPass.connect(compresor);
    compresor.connect(shelfFilter);
    shelfFilter.connect(gainNode);
    
    return gainNode; 
}
import { $ } from '../script.js';

// Variables de estado locales para el control del archivo cargado
let studioTrackFileName = null;
let studioTrackBlob = null;
let studioTrackId = null;

// Variables globales para la grabación en dúo encapsuladas en el módulo
let studioStream2 = null;
let duoAudioContext = null;
let duoAnalyser1 = null;
let duoAnalyser2 = null;
let duoAnimationId = null;

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

  if (!player || !player.src) {
    alert("⚠️ Primero sube una pista");
    return;
  }

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
  
  // Ejecución segura en caso de que la función de resaltado esté en otra pestaña
  if (typeof updateKaraokeHighlight === 'function') {
    updateKaraokeHighlight(0);
  }
}
import { $ } from '../script.js';
import { aplicarCadenaDeAudioKaraoke } from './estudio.js'; // Conexión local interna

// Variables de estado específicas de la grabación encapsuladas en el módulo
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

// Función auxiliar temporal en caso de que getSelectedMicId esté en la pestaña config
function getSelectedMicId(micNumber) {
  const select = document.getElementById(`mic${micNumber}Select`);
  return select ? select.value : null;
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

    if (!isDuo) {
      duoAnalyser1.connect(merger, 0, 1);
    }

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

/**
 * Monitor visual de niveles de audio en tiempo real para dúos
 */
import { $ } from '../script.js';
import { addLibraryItem } from './biblioteca.js'; // Conexión modular con el motor CRUD de la base de datos

// Variables compartidas con el grabador (asegúrate de que estén arriba en tu archivo)
let studioChunks = [];
let studioRecordedBlob = null;
let studioMediaRecorder = null;
let studioStream = null;
let studioStream2 = null;
let duoAudioContext = null;
let duoAnalyser1 = null;
let duoAnalyser2 = null;
let duoAnimationId = null;
let studioTrackFileName = null;

/**
 * Monitor visual de niveles de audio para los micrófonos (Unificado y Corregido)
 */
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

/**
 * Detiene de manera segura el bucle de fotogramas del monitor de volumen
 */
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

/**
 * Detiene la grabación multimedia y apaga el hardware de los micrófonos
 */
export function stopStudioRecording() {
  if (studioMediaRecorder && studioMediaRecorder.state !== "inactive") {
    studioMediaRecorder.stop();
  }

  if (studioStream) {
    studioStream.getTracks().forEach(track => track.stop());
  }

  if (studioStream2) {
    studioStream2.getTracks().forEach(track => track.stop());
    studioStream2 = null;
  }

  if (duoAudioContext) {
    duoAudioContext.close();
    duoAudioContext = null;
  }

  duoAnalyser1 = null;
  duoAnalyser2 = null;

  stopDuoLevelMonitor();

  const duoIndicator = $("duoIndicator");
  if (duoIndicator) {
    duoIndicator.style.display = "none";
  }

  const player = $("player");
  if (player) {
    player.pause();
  }
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
      audioData: studioRecordedBlob // Almacena el archivo blob de audio de forma local offline
    });

    const status = $("studioStatus");
    if (status) status.textContent = "Estado: grabación guardada en Biblioteca";
    alert("🚀 ¡Grabación guardada con éxito en tu Biblioteca local!");
  } catch (error) {
    console.error("Error al guardar la grabación en IndexedDB:", error);
    alert("❌ Hubo un error al intentar guardar en la base de datos.");
  }
}
import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById } from './biblioteca.js'; // Conexión modular segura

// Variables de estado locales del reproductor (asegúrate de que estén arriba en tu archivo)
let studioTrackFileName = null;
let studioTrackBlob = null;
let studioTrackId = null;
let studioSelectedTrackName = null;
let studioSelectedTrackBlob = null;
let studioSelectedTrackId = null;

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
 * Carga la pista seleccionada en el reproductor multimedia multimedia principal
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
import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById } from './biblioteca.js';

// Variables de estado específicas para el control de la voz seleccionada
let selectedVoiceBlob = null;
let selectedVoiceId = null;

// Variables de segmentos de letras encapsuladas localmente en el Estudio
let transcriptionSegments = [];
let baseTranscriptionSegments = [];

/**
 * Función exportable para que la Biblioteca pueda inyectar datos asíncronos cuando cargue un UltraStar
 */
export function setTranscriptionSegments(data) {
  baseTranscriptionSegments = data;
  transcriptionSegments = data;
}

/**
 * Función de seguridad para evitar errores si la función original viene más adelante en el script viejo
 */
function buildWordTimingFromSegment(seg) {
  if (typeof window.buildWordTimingFromSegment === 'function') {
    return window.buildWordTimingFromSegment(seg);
  }
  // Retorno seguro por defecto en caso de que no exista aún
  return { ...seg, words: seg.words || [] };
}

/**
 * Carga en el selector desplegable las voces y grabaciones guardadas en IndexedDB
 */
export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;

  try {
    // LLAMADAS MODULARES: Consume datos desde el core de la biblioteca offline
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
    console.error("Error al cargar opciones de voces en Estudio:", error);
  }
}

/**
 * Descarga la voz seleccionada de la BD e inyecta su letra y tiempos en el Monitor
 */
export async function loadSelectedVoiceFromLibrary() {
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

    // Si el archivo de audio ya contiene letras sincronizadas por Taps de fondo, las restaura instantáneamente
    if (Array.isArray(item.transcription) && item.transcription.length > 0) {
      baseTranscriptionSegments = item.transcription.map(seg =>
        buildWordTimingFromSegment(seg)
      );

      transcriptionSegments = baseTranscriptionSegments;

      // Validadores de seguridad para las funciones periféricas de pintado de pantalla
      if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
      if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();

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

      if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics([]);
      if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();

      if (lyricsText) lyricsText.value = "";
      status.textContent = `Estado: voz seleccionada -> ${item.name} (sin transcripción guardada)`;
    }
  } catch (error) {
    console.error("Error al procesar la voz seleccionada de la biblioteca:", error);
    alert("❌ No se pudo cargar la voz seleccionada");
  }
}
import { $ } from '../script.js';
import { addLibraryItem, getLibraryItemById, updateLibraryItem, renderLibrary } from './biblioteca.js';

// Variables compartidas con el grabador (asegúrate de que estén declaradas arriba en este mismo archivo)
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let transcriptionSegments = [];
let baseTranscriptionSegments = [];

/**
 * UTILERÍA: Convierte porciones de AudioBuffer a formato WAV binario nativo
 */
function audioBufferToWav(buffer, startSample, endSample) {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const subBufferLength = endSample - startSample;
  const bufferLength = subBufferLength * numOfChan * 2 + 44;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  // Escribir cabecera WAV (RIFF)
  view.setUint32(0, 0x46464952, true); // "RIFF"
  view.setUint32(4, bufferLength - 8, true);
  view.setUint32(8, 0x45564157, true); // "WAVE"
  view.setUint32(12, 0x20746d66, true); // "fmt "
  view.setUint32(16, 16, true); // tamaño subchunk
  view.setUint16(20, 1, true); // PCM sin compresión
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * 2, true); // byte rate
  view.setUint16(32, numOfChan * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x61746164, true); // "data"
  view.setUint32(40, subBufferLength * numOfChan * 2, true);

  // Escribir muestras entrelazadas de audio
  let offset = 44;
  for (let i = startSample; i < endSample; i++) {
    for (let channel = 0; channel < numOfChan; channel++) {
      let sample = buffer.getChannelData(channel)[i];
      sample = Math.max(-1, Math.min(1, sample)); // Clamping seguro
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/**
 * UTILERÍA: Transforma un objeto Blob a String Base64 de forma asíncrona
 */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result.split(",")[1];
      resolve(base64String);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * UTILERÍA: Divide segmentos de texto largos en líneas cortas ideales para cantar
 */
function splitSegmentsIntoKaraokeLines(segments, maxWordsPerLine = 6) {
  let output = [];
  segments.forEach(seg => {
    const words = seg.words || [];
    if (words.length <= maxWordsPerLine) {
      output.push(seg);
      return;
    }
    // Sub-segmentación matemática por número de palabras
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      const chunkWords = words.slice(i, i + maxWordsPerLine);
      const textLine = chunkWords.map(w => w.word).join(" ");
      output.push({
        start: chunkWords[0].start,
        end: chunkWords[chunkWords.length - 1].end,
        text: textLine,
        words: chunkWords
      });
    }
  });
  return output;
}

/**
 * Corrección de respaldo por seguridad
 */
function buildWordTimingFromSegment(seg) {
  if (!seg.words) {
    // Si Whisper no devolvió marcas por palabra, creamos una simulación matemática lineal homogénea
    const wordsArr = seg.text.split(" ");
    const duration = seg.end - seg.start;
    const wordDuration = duration / wordsArr.length;
    seg.words = wordsArr.map((word, i) => ({
      word: word,
      start: seg.start + i * wordDuration,
      end: seg.start + (i + 1) * wordDuration
    }));
  }
  return seg;
}

/**
 * Corta el archivo de voz en porciones y lo envía a procesar a la API de Whisper
 */
export async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) {
    alert("⚠️ Primero selecciona y carga una voz desde Biblioteca");
    return;
  }

  const status = $("selectedVoiceStatus");
  const lyricsText = $("lyricsText");

  try {
    if (status) status.textContent = "Estado: Preparando audio (cortando en porciones)...";

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await selectedVoiceBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const CHUNK_SECONDS = 25; // Tamaño del trozo para evitar agotar la RAM de la API
    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const samplesPerChunk = CHUNK_SECONDS * sampleRate;

    let fullSegments = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      const chunkNumber = Math.floor(start / samplesPerChunk) + 1;
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);

      if (status) status.textContent = `Estado: Transcribiendo parte ${chunkNumber} de ${totalChunks}...`;

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
          text: segText,
          words: seg.words ? seg.words.map(w => ({...w, start: w.start + timeOffset, end: w.end + timeOffset})) : null
        };

        fullSegments.push(buildWordTimingFromSegment(segmentWithOffset));
      });
    }

    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);

    if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
    if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();

    if (lyricsText) {
      lyricsText.value = transcriptionSegments.map(line => line.text).join("\n");
    }

    // GENERADOR AUTOMÁTICO DE ARCHIVO DE TEXTO ULTRASTAR COMPATIBLE
    try {
      const vozOriginal = await getLibraryItemById(selectedVoiceId); 
      const nombreBase = vozOriginal ? vozOriginal.name.replace(/🎙️ Voz - |Voz - /g, "") : "Nueva Canción";
      
      const bpmPorDefecto = 120;
      const gapPorDefecto = 0;
      const duracionUnBeat = 60 / (bpmPorDefecto * 4); // Resolución x4 para evitar desfases de tiempo

      const cabeceraUltraStar = `#TITLE:${nombreBase}\n#ARTIST:Whisper Transcribe\n#BPM:${bpmPorDefecto}\n#GAP:${gapPorDefecto}\n`;
      let lineasCuerpo = [];

      baseTranscriptionSegments.forEach((seg) => {
        const startBeat = Math.max(0, Math.floor(seg.start / duracionUnBeat));
        const endBeat = Math.max(startBeat + 1, Math.floor(seg.end / duracionUnBeat));
        const lengthBeats = endBeat - startBeat;
        const pitchBase = 0; // Se inicializa en 0 para edición por Taps o canto posterior
        const textoLimpio = seg.text ? ` ${seg.text.trim()}` : " ...";

        lineasCuerpo.push(`: ${startBeat} ${lengthBeats} ${pitchBase}${textoLimpio}`);

        if (seg.text && (seg.text.includes("\n") || seg.text.includes(".") || seg.text.includes(","))) {
          lineasCuerpo.push("-");
        }
      });

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

    if (selectedVoiceId) {
      try {
        await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
        console.log("✅ Transcripción vinculada a la voz original");
      } catch (err) {
        console.error("❌ Error guardando transcripción en la voz:", err);
      }
    }

    if (status) status.textContent = "Estado: Transcripción completada y guardada en texto ✅";

  } catch (error) {
    console.error(error);
    alert("❌ Error al transcribir el audio.");
    if (status) status.textContent = "Estado: Error en la transcripción";
  }
}

/**
 * Captura el texto del mini monitor de edición y lo almacena de forma física offline
 */
export async function guardarTextoUltraStarEnBiblioteca() {
  try {
    const textoMonitor = document.getElementById("miniMonitorTextArea")?.value || ""; 
    
    if (!textoMonitor.trim()) {
      alert("⚠️ El monitor está vacío. No hay texto para guardar.");
      return;
    }

    const tituloCancion = window.currentSongTitle || "Nueva Canción";
    const artistaCancion = window.currentSongArtist || "Artista Desconocido";

    await addLibraryItem({
        name: `UltraStar - ${tituloCancion} (${artistaCancion})`,
        type: "ultrastar_txt", 
        audioBlob: null,
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
export function buildWordTimingFromSegment(segment) {
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
        word: word,
        start: segment.start,
        end: segment.end,
        pitch: segment.pitch || 0,
        note: segment.note || "C4"
      }))
    };
  }

  const sliceDuration = segmentDuration / rawWords.length;
  let cursor = segment.start;

  const timedWords = rawWords.map((word) => {
    const wordStart = cursor;
    const wordEnd = cursor + sliceDuration;
    cursor = wordEnd;

    return {
      word: word,
      start: wordStart,
      end: wordEnd,
      pitch: segment.pitch || 0,
      note: segment.note || "C4",
      sincronizado: false 
    };
  });

  return {
    ...segment,
    words: timedWords
  };
}
// Importamos las utilidades de conversión de notas desde el Afinador para no duplicar código global
import { getNoteFromFrequency } from './afinador.js';

/**
 * Función puente local para obtener el número MIDI (Equivale a la que usa el Karaoke de forma nativa)
 */
function frequencyToMidi(freq) {
  if (freq <= 0) return 0;
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

/**
 * Analiza porciones de audio en diferido para adjuntar notas musicales reales a las letras transcritas
 */
export async function analyzePitchForSegments(audioBlob, segments) {
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

    const analyzedSegments = segments.map((segment) => {
      const startSample = Math.floor(segment.start * sampleRate);
      const endSample = Math.floor(segment.end * sampleRate);
      
      const safeStart = Math.max(0, Math.min(startSample, channelData.length));
      const safeEnd = Math.max(safeStart, Math.min(endSample, channelData.length));
      const segmentSamples = channelData.slice(safeStart, safeEnd);
      
      const pitch = detectPitchFromSamples(segmentSamples, sampleRate);
      const note = pitch > 0 ? getNoteFromFrequency(pitch) : null;
      const midiNote = pitch > 0 ? frequencyToMidi(pitch) : null;
      
      let analyzedWords = [];
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        analyzedWords = segment.words.map(word => {
          const wordSampleStart = Math.floor(word.start * sampleRate);
          const wordSampleEnd = Math.floor(word.end * sampleRate);
          
          const safeWordStart = Math.max(0, Math.min(wordSampleStart, channelData.length));
          const safeWordEnd = Math.max(safeWordStart, Math.min(wordSampleEnd, channelData.length));
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

/**
 * Algoritmo matemático avanzado de Autocorrelación con Interpolación Parabólica (Offline)
 */
function detectPitchFromSamples(samples, sampleRate) {
  if (!samples || samples.length < 64) return -1; 
  
  let buffer = new Float32Array(2048);
  if (samples.length < 2048) {
    buffer.set(samples, 0); 
  } else {
    buffer = samples.slice(0, 2048);
  }

  const bufferSize = buffer.length;
  
  let rms = 0;
  for (let i = 0; i < bufferSize; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / bufferSize);
  if (rms < 0.01) return -1; 

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
import { buildWordTimingFromSegment } from './estudio.js'; // Conexión local interna

/**
 * Mapea el texto editado a mano por el usuario preservando los tiempos originales de Whisper/Taps
 */
export function buildSegmentsFromMultilineLyrics(text, baseSegments) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length || !Array.isArray(baseSegments) || !baseSegments.length) {
    return [];
  }

  let palabraIndexGlobal = 0;
  const todasLasPalabrasBase = [];
  
  baseSegments.forEach(seg => {
    if (seg.words) todasLasPalabrasBase.push(...seg.words);
  });

  if (todasLasPalabrasBase.length === 0) {
    return aproximarTiemposPorDefecto(lines, baseSegments);
  }

  return lines.map((line) => {
    const rawWords = line.split(/\s+/).filter(Boolean);
    const timedWords = [];

    rawWords.forEach((word) => {
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

/**
 * Distribuye homogéneamente el tiempo total disponible si no existe un buffer de marcas previo
 */
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
import { $ } from '../script.js';
import { updateLibraryItem } from './biblioteca.js'; // Conexión modular con la BD
import { buildSegmentsFromMultilineLyrics } from './estudio.js'; // Referencia local interna

// Asegúrate de enlazar con las variables del Estudio declaradas arriba en tu archivo:
let baseTranscriptionSegments = [];
let transcriptionSegments = [];
let selectedVoiceId = null;

/**
 * Captura las correcciones manuales del editor, recompone las sílabas temporales
 * y refresca los monitores del Karaoke de forma unificada sin corromper la memoria.
 */
export async function applyCorrectedLyrics() {
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

  // LLAMADA LOCAL: Procesa las líneas preservando la rejilla de Whisper
  const rebuiltSegments = buildSegmentsFromMultilineLyrics(correctedText, baseTranscriptionSegments);

  if (!rebuiltSegments.length) {
    alert("⚠️ No se pudo reconstruir la letra corregida.");
    return;
  }

  baseTranscriptionSegments = rebuiltSegments;
  transcriptionSegments = rebuiltSegments;

  // Actualización cruzada segura en los monitores visuales activos de la pantalla
  if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
  if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();

  lyricsText.value = transcriptionSegments
    .map(seg => seg.text || "")
    .join("\n")
    .trim();

  if (selectedVoiceId) {
    try {
      // Sincronización asíncrona persistente dentro de la base de datos de tu Biblioteca
      await updateLibraryItem(selectedVoiceId, {
        transcription: baseTranscriptionSegments
      });

      if (status) status.textContent = "Estado: letra corregida aplicada y guardada ✅";
    } catch (error) {
      console.error("Error guardando corrección de letra en IndexedDB:", error);
      if (status) status.textContent = "Estado: letra corregida aplicada, pero no se pudo guardar en BD";
    }
  } else {
    if (status) status.textContent = "Estado: letra corregida aplicada ✅";
  }
}
import { $ } from '../script.js';
import { buildWordTimingFromSegment, analyzePitchForSegments } from './estudio.js'; // Conexiones locales internas
import { addLibraryItem, updateLibraryItem } from './biblioteca.js'; // Conexión modular segura con la BD

// Asegúrate de enlazar con las variables de estado del Estudio declaradas arriba en tu archivo:
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;
let baseTranscriptionSegments = [];
let transcriptionSegments = [];
let selectedVoiceBlob = null;
let selectedVoiceId = null;
let studioSelectedTrackBlob = null;
let studioSelectedTrackName = "Sin título";
let studioSelectedTrackId = null;

/**
 * Inicia el sistema de captura de toques reiniciando el reproductor de voz y asegurando oyentes únicos
 */
export function startTapSync() {
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
  
  const startBtn = $("startTapSyncBtn");
  const cancelBtn = $("cancelTapSyncBtn");
  const activeBox = $("tapSyncActive");
  const resultBox = $("tapSyncResult");

  if (startBtn) startBtn.style.display = "none";
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  if (activeBox) activeBox.style.display = "block";
  if (resultBox) resultBox.style.display = "none";
  
  updateTapSyncDisplay();
  
  voicePlayer.currentTime = 0;
  voicePlayer.play();
  
  // Limpieza preventiva para evitar la acumulación caótica de listeners duplicados
  document.removeEventListener("keydown", handleTapSyncKeypress);
  document.addEventListener("keydown", handleTapSyncKeypress);
  
  console.log("🎯 Sincronización iniciada de forma limpia. Líneas:", tapSyncLines.length);
}

/**
 * Escuchador de teclado físico para capturar la barra espaciadora como pulso musical
 */
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

/**
 * Registra la marca de tiempo exacta del reproductor y gatilla la animación visual en la pantalla
 */
export function recordTap() {
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

/**
 * Refresca las etiquetas de texto de la interfaz con el renglón actual por cantar
 */
export function updateTapSyncDisplay() {
  const currentLineEl = $("tapCurrentLine");
  const progressEl = $("tapProgress");
  
  if (currentLineEl && tapSyncCurrentIndex < tapSyncLines.length) {
    currentLineEl.textContent = tapSyncLines[tapSyncCurrentIndex];
  }
  
  if (progressEl) {
    progressEl.textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`;
  }
}

/**
 * Detiene los escuchadores y congela la grabación de pulsos temporalmente al terminar el texto
 */
export function finishTapSync() {
  tapSyncMode = false;
  
  const voicePlayer = $("selectedVoicePlayer");
  if (voicePlayer) voicePlayer.pause();
  
  document.removeEventListener("keydown", handleTapSyncKeypress);
  
  const activeBox = $("tapSyncActive");
  const resultBox = $("tapSyncResult");
  const cancelBtn = $("cancelTapSyncBtn");

  if (activeBox) activeBox.style.display = "none";
  if (resultBox) resultBox.style.display = "block";
  if (cancelBtn) cancelBtn.style.display = "none";
  
  console.log("✅ Sincronización completada. Timestamps:", tapSyncTimestamps);
}

/**
 * Apaga el flujo de toques y vacía los arreglos temporales de memoria de forma limpia
 */
export function cancelTapSync() {
  tapSyncMode = false;
  
  const voicePlayer = $("selectedVoicePlayer");
  if (voicePlayer) voicePlayer.pause();
  
  document.removeEventListener("keydown", handleTapSyncKeypress);
  
  const startBtn = $("startTapSyncBtn");
  const cancelBtn = $("cancelTapSyncBtn");
  const activeBox = $("tapSyncActive");
  const resultBox = $("tapSyncResult");

  if (startBtn) startBtn.style.display = "inline-block";
  if (cancelBtn) cancelBtn.style.display = "none";
  if (activeBox) activeBox.style.display = "none";
  if (resultBox) resultBox.style.display = "none";
  
  tapSyncLines = [];
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
}

/**
 * Procesa las estrofas capturadas, recorta silencios instrumentales dilatados, 
 * analiza las frecuencias armónicas mediante el analizador offline y genera el archivo Karaoke final.
 */
export async function applyTapSync() {
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
    
    // CORRECCIÓN PROTECTORA DE PAUSAS EN SILENCIOS INSTRUMENTALES
    const distanciaEntreTaps = end - start;
    if (distanciaEntreTaps > 1.2) {
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
  
  // Guardado de la canción estructurada final tipo "karaoke" offline en la base de datos
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
          console.error("❌ Error creando karaoke en la base de datos:", err);
      }
  } else {
      console.warn("⚠️ No hay pista instrumental seleccionada para crear karaoke");
  }
  
  // Actualización cruzada en los monitores de texto visuales activos en la pantalla
  if (typeof renderKaraokeLyrics === "function") renderKaraokeLyrics(transcriptionSegments);
  if (typeof cargarLetrasEnMonitor === "function") cargarLetrasEnMonitor();
  
  if (selectedVoiceId) {
      updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments })
          .then(() => console.log("✅ Historial de letra sincronizada acoplada a la voz original"))
          .catch(err => console.error("Error sincronizando voz en biblioteca:", err));
  }
  
  const startBtn = $("startTapSyncBtn");
  const resultBox = $("tapSyncResult");
  if (startBtn) startBtn.style.display = "inline-block";
  if (resultBox) resultBox.style.display = "none";
  
  tapSyncLines = [];
  tapSyncTimestamps = [];
  tapSyncCurrentIndex = 0;
  
  if (status) status.textContent = "Estado: ✅ Sincronización y notas aplicadas";
  alert("✅ ¡Tiempos y notas aplicados de forma estable! Reproduce para verificar.");
}

/**
 * Limpia el panel de resultados y reinicia el ciclo de escucha desde cero
 */
export function redoTapSync() {
  const resultBox = $("tapSyncResult");
  if (resultBox) resultBox.style.display = "none";
  startTapSync();
}
