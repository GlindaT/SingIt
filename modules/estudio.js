// modules/estudio.js - ENTORNO DE MASTERIZACIÓN, TRANSCRIPCIÓN Y PULSOS RÍTMICOS

import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById, updateLibraryItem, addLibraryItem, getAllLibraryItems } from './biblioteca.js'; // <-- VERIFICA QUE "getLibraryItemsByType" ESTÉ AQUÍ ADENTRO

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
let studioTrackBlob = null;
let studioTrackId = null;
let studioSelectedTrackName = null;
let studioSelectedTrackBlob = null;

let selectedVoiceBlob = null;
let selectedVoiceId = null;

let transcriptionSegments = [];
let baseTranscriptionSegments = [];

let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

export function buildWordTimingFromSegment(seg) {
  if (!seg.words || seg.words.length === 0) {
    const wordsArr = (seg.text || "").split(" ").filter(Boolean);
    const duration = (seg.end || 0) - (seg.start || 0);
    const wordDuration = duration / Math.max(1, wordsArr.length);
    seg.words = wordsArr.map((word, i) => ({
      word: word,
      start: seg.start + i * wordDuration,
      end: seg.start + (i + 1) * wordDuration,
      pitch: 0,
      midi: 60,
      note: "C4"
    }));
  }
  return seg;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => { resolve(reader.result.split(",")[1]); };
    reader.readAsDataURL(blob);
  });
}

function splitSegmentsIntoKaraokeLines(segments, maxWordsPerLine = 6) {
  let output = [];
  segments.forEach(seg => {
    const words = seg.words || [];
    if (words.length <= maxWordsPerLine) { output.push(seg); return; }
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      const chunkWords = words.slice(i, i + maxWordsPerLine);
      output.push({
        start: chunkWords[0].start,
        end: chunkWords[chunkWords.length - 1].end,
        text: chunkWords.map(w => w.word).join(" "),
        words: chunkWords
      });
    }
  });
  return output;
}

function audioBufferToWav(buffer, startSample, endSample) {
  const originalSampleRate = buffer.sampleRate;
  const targetSampleRate = 16000; 
  const chanData0 = buffer.getChannelData(0);
  const duration = (endSample - startSample) / originalSampleRate;
  const targetLength = Math.floor(duration * targetSampleRate);
  
  const bufferLength = targetLength * 2 + 44; 
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  view.setUint32(0, 0x46464952, true); view.setUint32(4, bufferLength - 8, true);
  view.setUint32(8, 0x45564157, true); view.setUint32(12, 0x20746d66, true); 
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);        
  view.setUint32(24, targetSampleRate, true); view.setUint32(28, targetSampleRate * 2, true); 
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);       
  view.setUint32(36, 0x61746164, true); view.setUint32(40, targetLength * 2, true);

  let offset = 44;
  for (let i = 0; i < targetLength; i++) {
    const idx = startSample + Math.floor((i / targetSampleRate) * originalSampleRate);
    if (idx >= endSample) break;
    let sample = Math.max(-1, Math.min(1, chanData0[idx]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
  if (!audioCtx || !source) return null;

  // 1. Filtro Paso Alto: Elimina ruidos graves de fondo por debajo de 60Hz
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass"; 
  highPass.frequency.value = 60;

  // 2. Compresor Dinámico: Nivela los picos de volumen cuando cantas fuerte
  const compresor = audioCtx.createDynamicsCompressor();
  compresor.threshold.setValueAtTime(-24, audioCtx.currentTime);
  compresor.knee.setValueAtTime(30, audioCtx.currentTime);
  compresor.ratio.setValueAtTime(4, audioCtx.currentTime);
  compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compresor.release.setValueAtTime(0.25, audioCtx.currentTime);

  // 3. Ecualizador de Brillo: Resalta las frecuencias altas (4kHz) para darle claridad a la voz
  const shelfFilter = audioCtx.createBiquadFilter();
  shelfFilter.type = "highshelf"; 
  shelfFilter.frequency.value = 4000; 
  shelfFilter.gain.value = 2.0;

  // 4. Nodo de Ganancia: Control de volumen final amplificado
  const gainNode = audioCtx.createGain(); 
  gainNode.gain.value = 1.4; 

  // Conexión en serie de los efectos
  source.connect(highPass); 
  highPass.connect(compresor); 
  compresor.connect(shelfFilter); 
  shelfFilter.connect(gainNode);

  return gainNode; 
}

export function cargarAudioEstudio(e) {
  const file = e.target.files[0]; if (!file) return;
  studioTrackFileName = file.name; studioTrackBlob = file;
  $("player").src = URL.createObjectURL(file);
  $("studioStatus").textContent = `Estado: pista cargada (${file.name})`;
  console.log("🎵 [Estudio] Pista instrumental cargada temporalmente desde PC:", file.name);
}

export function playTrack() { if ($("player")?.src) $("player").play(); }
export function pauseTrack() { $("player")?.pause(); }
export function stopTrack() { if ($("player")) { $("player").pause(); $("player").currentTime = 0; } }

export async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  const tracks = await getLibraryItemsByType("pista");
  tracks.forEach(t => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; select.appendChild(o); });
}

export async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect");
  const item = await getLibraryItemById(Number(select.value));
  if (item) { 
    studioSelectedTrackName = item.name; studioSelectedTrackBlob = item.audioBlob; 
    $("player").src = URL.createObjectURL(item.audioBlob); 
    $("studioStatus").textContent = `Pista de biblioteca cargada: ${item.name}`;
    console.log("📥 [Estudio] Sincronizada Pista de Fondo de la biblioteca:", item.name);
  }
}

export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;
  const todos = await getAllLibraryItems();
  const filtered = todos.filter(i => ["voz", "grabacion", "grabación"].includes(i.type?.toLowerCase()));
  filtered.forEach(v => { const o = document.createElement("option"); o.value = v.id; o.textContent = v.name; select.appendChild(o); });
  console.log(`estudio.js:452 🎙️ Selector de voces del Estudio actualizado de forma segura.`);
}

export async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect");
  const item = await getLibraryItemById(Number(select.value));
  if (!item) return;

  selectedVoiceBlob = item.audioBlob || item.audioData; selectedVoiceId = item.id;
  $("selectedVoicePlayer").src = URL.createObjectURL(selectedVoiceBlob);
  $("selectedVoiceStatus").textContent = `Voz cargada: ${item.name}`;
  console.log("📥 [Estudio] Voz del cantante cargada:", item.name);

  if (Array.isArray(item.transcription) && item.transcription.length > 0) {
    console.log("♻️ [Estudio] ¡Reutilizando transcripción existente para evitar re-transcribir con la API!");
    baseTranscriptionSegments = item.transcription.map(s => buildWordTimingFromSegment(s));
    transcriptionSegments = baseTranscriptionSegments;
    
    const { renderKaraokeLyrics, cargarLetrasEnMonitor } = await import('./karaoke.js');
    renderKaraokeLyrics(transcriptionSegments); cargarLetrasEnMonitor();
    if ($("lyricsText")) $("lyricsText").value = transcriptionSegments.map(s => s.text || "").join("\n");
    $("selectedVoiceStatus").textContent = `Estado: Voz cargada (Letras recicladas de memoria ⚡)`;
  } else {
    if ($("lyricsText")) $("lyricsText").value = "";
  }
}

export async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) { alert("⚠️ Carga una voz primero"); return; }
  const status = $("selectedVoiceStatus");
  try {
    status.textContent = "Estado: Reduciendo peso a 16kHz Mono... ⏳";
    const audioBuffer = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(await selectedVoiceBlob.arrayBuffer());
    const CHUNK_SECONDS = 20, sampleRate = audioBuffer.sampleRate, totalSamples = audioBuffer.length, samplesPerChunk = CHUNK_SECONDS * sampleRate;
    let fullSegments = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      status.textContent = `Estado: Transcribiendo con Whisper IA (${Math.floor(start/samplesPerChunk)+1} / ${Math.ceil(totalSamples/samplesPerChunk)})... 🚀`;

      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: await blobToBase64(audioBufferToWav(audioBuffer, start, end)) }) });
      if (!response.ok) throw new Error("Error en servidor Vercel API");
      
      const result = await response.json();
      const timeOffset = start / sampleRate;
      (result.segments || []).forEach(seg => {
        if (!seg.text || ["amara", "subtítulos"].some(p => seg.text.toLowerCase().includes(p))) return;
        fullSegments.push(buildWordTimingFromSegment({ start: Number(seg.start || 0) + timeOffset, end: Number(seg.end || 0) + timeOffset, text: seg.text.trim(), words: seg.words ? seg.words.map(w => ({ ...w, start: w.start + timeOffset, end: w.end + timeOffset })) : null }));
      });
    }
    
    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);
    
    // CORRECCIÓN ASÍNCRONA BLINDADA: Importación perezosa protegida contra herencia de clases
    const karaokeModulo = await import('./karaoke.js');
    if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
      karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
    } else {
      console.log("📝 [estudio.js] Transcripción acoplada a la memoria del motor gráfico.");
    }
    
    if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
      karaokeModulo.cargarLetrasEnMonitor();
    }
    
    if ($("lyricsText")) $("lyricsText").value = transcriptionSegments.map(l => l.text).join("\n");
    
    console.log("estudio.js:753 ✅ Archivo de texto UltraStar TXT creado con éxito en la Biblioteca");
    if (selectedVoiceId) {
      await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
      console.log("estudio.js:763 ✅ Transcripción vinculada a la voz original.");
    }
    status.textContent = "Estado: Transcripción completada ✅";
  } catch (err) { 
    console.error("estudio.js:749 Error crítico en la llamada de Whisper IA:", err); 
    status.textContent = "Estado: Error ❌";
  }
}
// ==========================================
// 7. CORRECCIÓN Y SINCRONIZACIÓN MANUAL (TAPS)
// ==========================================

export async function applyCorrectedLyrics() {
  console.log("📝 [estudio.js] Iniciando reconstrucción de letra corregida...");
  const text = $("lyricsText"); 
  if (!text || !text.value.trim()) return;
  
  const lines = text.value.split("\n").map(l => l.trim()).filter(Boolean);
  let palabraIndex = 0;
  let todasLasPalabras = [];
  
  if (Array.isArray(baseTranscriptionSegments)) {
    baseTranscriptionSegments.forEach(s => { 
      if (s.words) todasLasPalabras.push(...s.words); 
    });
  }

  const rebuilt = lines.map(line => {
    const words = line.split(/\s+/).filter(Boolean);
    const timed = words.map(w => {
      const base = todasLasPalabras[palabraIndex] || todasLasPalabras[todasLasPalabras.length - 1];
      palabraIndex++;
      return { 
        word: w, 
        start: base ? base.start : 0, 
        end: base ? base.end : 1, 
        pitch: base ? base.pitch : 0, 
        note: base ? base.note : "C4" 
      };
    });
    return { 
      start: timed.length ? timed[0].start : 0, 
      end: timed.length ? timed[timed.length - 1].end : 0, 
      text: line, 
      words: timed 
    };
  });

  baseTranscriptionSegments = rebuilt; 
  transcriptionSegments = rebuilt;
  console.log("📝 [estudio.js] Letra recompuesta con éxito. Re-inyectando en los monitores...");

  const karaokeModulo = await import('./karaoke.js');
  if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
    karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
  }
  if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
    karaokeModulo.cargarLetrasEnMonitor();
  }

  lyricsText.value = transcriptionSegments
    .map(seg => seg.text || "")
    .join("\n")
    .trim();

  if (selectedVoiceId) {
    try {
      await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
      console.log("💾 [estudio.js] Historial de letra corregida guardado físicamente en IndexedDB.");
    } catch (e) {
      console.warn("❌ [estudio.js] Error al persistir la letra corregida en IndexedDB:", e);
    }
  }
}

export function startTapSync() {
  console.log("🎯 [estudio.js] Activando modo captura de Taps rítmicos manuales...");
  const text = $("lyricsText"), player = $("selectedVoicePlayer");
  
  if (!text?.value.trim() || !player?.src) { 
    alert("⚠️ Carga la voz y la letra en el monitor primero antes de sincronizar."); 
    return; 
  }
  
  tapSyncLines = text.value.split("\n").map(l => l.trim()).filter(Boolean);
  tapSyncTimestamps = []; 
  tapSyncCurrentIndex = 0; 
  tapSyncMode = true;
  
  $("startTapSyncBtn").style.display = "none"; 
  $("cancelTapSyncBtn").style.display = "inline-block"; 
  $("tapSyncActive").style.display = "block"; 
  $("tapSyncResult").style.display = "none";
  
  updateTapSyncDisplay(); 
  player.currentTime = 0; 
  player.play();
  
  document.removeEventListener("keydown", handleTapSyncKeypress); 
  document.addEventListener("keydown", handleTapSyncKeypress);
}

function handleTapSyncKeypress(e) { 
  if (tapSyncMode && (e.code === "Space" || e.key === " ")) { 
    e.preventDefault(); 
    recordTap(); 
  } 
}

export function recordTap() {
  const player = $("selectedVoicePlayer"); 
  if (!tapSyncMode || !player) return;
  
  const marcaTiempoActual = player.currentTime;
  tapSyncTimestamps.push(marcaTiempoActual); 
  console.log(`🎵 [estudio.js] PULSO REGISTRADO -> Línea ${tapSyncCurrentIndex + 1}: "${tapSyncLines[tapSyncCurrentIndex]}" a los ${marcaTiempoActual.toFixed(2)}s`);
  
  tapSyncCurrentIndex++;
  
  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    console.log("✅ [estudio.js] Captura de Taps rítmicos completada con éxito.");
    tapSyncMode = false; 
    player.pause(); 
    document.removeEventListener("keydown", handleTapSyncKeypress);
    
    $("tapSyncActive").style.display = "none"; 
    $("tapSyncResult").style.display = "block"; 
    $("cancelTapSyncBtn").style.display = "none";
  } else {
    updateTapSyncDisplay();
  }
}

export function updateTapSyncDisplay() { 
  if ($("tapCurrentLine")) $("tapCurrentLine").textContent = tapSyncLines[tapSyncCurrentIndex]; 
  if ($("tapProgress")) $("tapProgress").textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`; 
}

export function cancelTapSync() { 
  console.log("❌ [estudio.js] Cancelando captura de toques rítmicos y limpiando variables temporales.");
  tapSyncMode = false; 
  $("selectedVoicePlayer")?.pause(); 
  document.removeEventListener("keydown", handleTapSyncKeypress); 
  
  $("startTapSyncBtn").style.display = "inline-block"; 
  $("cancelTapSyncBtn").style.display = "none"; 
  $("tapSyncActive").style.display = "none"; 
  $("tapSyncResult").style.display = "none"; 
}

export async function applyTapSync() {
  console.log("🚀 [estudio.js] Iniciando empaquetado final del proyecto Karaoke...");
  const player = $("selectedVoicePlayer"), total = player ? player.duration : 0;
  const status = $("selectedVoiceStatus");
  
  if (status) status.textContent = "Estado: Estructurando proyecto Karaoke y guardando en Biblioteca... ⏳";
  
  const segments = tapSyncLines.map((line, i) => {
    const start = tapSyncTimestamps[i] || 0;
    let end = tapSyncTimestamps[i+1] || total || start + 3;
    if (end - start > 1.2) end = start + Math.min(end - start, line.split(/\s+/).length * 0.45);
    return buildWordTimingFromSegment({ start, end, text: line });
  });

  baseTranscriptionSegments = segments; 
  transcriptionSegments = segments;

  const pistaInstrumentalActiva = studioSelectedTrackBlob || studioTrackBlob;
  const nombrePistaActiva = studioSelectedTrackName || studioTrackFileName || "Canción Sincronizada";

  if (pistaInstrumentalActiva) {
    try {
      const { addLibraryItem } = await import('./biblioteca.js');
      console.log(`💾 [estudio.js] Guardando archivo definitivo: "Karaoke - ${nombrePistaActiva}" con pista instrumental pura acoplada.`);
      
      await addLibraryItem({ 
        name: `Karaoke - ${nombrePistaActiva}`, 
        type: "karaoke", 
        audioBlob: pistaInstrumentalActiva, 
        date: new Date().toLocaleString("es-ES"), 
        transcription: segments, 
        metadata: { title: nombrePistaActiva, origen: "Estudio Sync Engine" } 
      });
    } catch (err) { 
      console.error("❌ [estudio.js] Error al registrar el proyecto de karaoke en IndexedDB:", err); 
    }
  } else {
    console.warn("⚠️ [estudio.js] Alerta: No se detectó ninguna pista de fondo activa en el reproductor. El proyecto se guardará sin base instrumental.");
  }

  const karaokeModulo = await import('./karaoke.js');
  if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
    karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
  } else {
    console.log("📝 [estudio.js] Partitura acoplada a la memoria compartida del Canvas.");
  }
  
  if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
    karaokeModulo.cargarLetrasEnMonitor();
  }

  if (selectedVoiceId) {
    await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments }).catch(() => {});
  }
  
  cancelTapSync();
  if (status) status.textContent = "Estado: ✅ ¡Proyecto de Karaoke guardado de forma exitosa!";
  alert("✅ ¡Sincronización Completada con éxito!\n\nSe ha creado tu nuevo proyecto de Karaoke utilizando la pista instrumental de fondo. Ya puedes ir a la pestaña 'Karaoke', presionar 'Actualizar' y cantarlo.");
}

export function redoTapSync() { 
  $("tapSyncResult").style.display = "none"; 
  startTapSync(); 
}
