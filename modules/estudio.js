// modules/estudio.js - PARTE 1: ARRANQUE, ESTADOS Y GRABACIÓN DE HARDWARE MULTI-MIC
import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById, updateLibraryItem, addLibraryItem, getAllLibraryItems } from './biblioteca.js';

let studioChunks = [];
let studioRecordedBlob = null;
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
let studioSelectedTrackId = null;

let selectedVoiceBlob = null;
let selectedVoiceId = null;

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
      note: "C4"
    }));
  }
  return seg;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(",")[1] || "");
      } else { resolve(""); }
    };
    reader.readAsDataURL(blob);
  });
}

function splitSegmentsIntoKaraokeLines(segments, maxWordsPerLine = 6) {
  let output = [];
  segments.forEach(seg => {
    const words = seg.words || [];
    if (words.length <= maxWordsPerLine) {
      output.push(seg);
      return;
    }
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

export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
  if (!audioCtx || !source) return null;
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass"; highPass.frequency.value = 60;
  const compresor = audioCtx.createDynamicsCompressor();
  compresor.threshold.setValueAtTime(-24, audioCtx.currentTime);
  compresor.knee.setValueAtTime(30, audioCtx.currentTime);
  compresor.ratio.setValueAtTime(4, audioCtx.currentTime);
  compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compresor.release.setValueAtTime(0.25, audioCtx.currentTime);
  const shelfFilter = audioCtx.createBiquadFilter();
  shelfFilter.type = "highshelf"; shelfFilter.frequency.value = 4000; shelfFilter.gain.value = 2.0;
  const gainNode = audioCtx.createGain(); gainNode.gain.value = 1.4; 

  source.connect(highPass); highPass.connect(compresor); compresor.connect(shelfFilter); shelfFilter.connect(gainNode);
  return gainNode; 
}

export function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;
  studioTrackFileName = file.name; studioTrackBlob = file; studioTrackId = null;
  const player = $("player"); if (player) player.src = URL.createObjectURL(file);
  $("studioStatus").textContent = `Estado: pista cargada (${file.name})`;
}

export function playTrack() { const player = $("player"); if (player && player.src) player.play(); else alert("⚠️ Primero sube o carga una pista instrumental."); }
export function pauseTrack() { const player = $("player"); if (player) player.pause(); }
export function stopTrack() { const player = $("player"); if (player) { player.pause(); player.currentTime = 0; } }
export async function startStudioRecording() {
  try {
    const player = $("player"); const isDuo = $("micCount")?.value === "2";
    studioChunks = []; studioRecordedBlob = null;
    if ($("voicePlayer")) $("voicePlayer").src = "";

    duoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = duoAudioContext.createMediaStreamDestination();
    const mic1Id = document.getElementById("mic1Select")?.value, mic2Id = document.getElementById("mic2Select")?.value;

    studioStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic1Id ? { exact: mic1Id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, duoAudioContext.createMediaStreamSource(studioStream));
    const volNode1 = duoAudioContext.createGain(); volNode1.gain.value = 0.75; mic1Filtrado.connect(volNode1);
    duoAnalyser1 = duoAudioContext.createAnalyser(); duoAnalyser1.fftSize = 2048; volNode1.connect(duoAnalyser1);

    const merger = duoAudioContext.createChannelMerger(2);
    duoAnalyser1.connect(merger, 0, 0);
    if (!isDuo) duoAnalyser1.connect(merger, 0, 1);

    if (isDuo && mic2Id) {
      studioStream2 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic2Id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
      const mic2Filtrado = aplicarCadenaDeAudioKaraoke(duoAudioContext, duoAudioContext.createMediaStreamSource(studioStream2));
      const volNode2 = duoAudioContext.createGain(); volNode2.gain.value = 0.75; mic2Filtrado.connect(volNode2);
      duoAnalyser2 = duoAudioContext.createAnalyser(); duoAnalyser2.fftSize = 2048; volNode2.connect(duoAnalyser2);
      duoAnalyser2.connect(merger, 0, 1);
      if ($("duoIndicator")) $("duoIndicator").style.display = "block";
    }

    merger.connect(destination);
    startDuoLevelMonitor();

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    studioMediaRecorder = new MediaRecorder(destination.stream, options);
    studioMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) studioChunks.push(e.data); };
    studioMediaRecorder.onstop = () => {
      studioRecordedBlob = new Blob(studioChunks, { type: "audio/webm" });
      if ($("voicePlayer")) $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
      if ($("studioStatus")) $("studioStatus").textContent = "Estado: grabación de voz lista";
      stopDuoLevelMonitor();
    };

    studioMediaRecorder.start();
    if (player?.src) { player.currentTime = 0; player.play(); }
    if ($("studioStatus")) $("studioStatus").textContent = "Estado: 🔴 Grabando voz...";
  } catch (err) { console.error(err); }
}

export function startDuoLevelMonitor() {
  const l1 = $("duoMic1Level"), l2 = $("duoMic2Level");
  function update() {
    if (duoAnalyser1 && l1) { const d1 = new Uint8Array(duoAnalyser1.frequencyBinCount); duoAnalyser1.getByteFrequencyData(d1); l1.style.width = Math.min(100, (d1.reduce((a,b)=>a+b,0)/d1.length/128)*100) + "%"; }
    if (duoAnalyser2 && l2) { const d2 = new Uint8Array(duoAnalyser2.frequencyBinCount); duoAnalyser2.getByteFrequencyData(d2); l2.style.width = Math.min(100, (d2.reduce((a,b)=>a+b,0)/d2.length/128)*100) + "%"; }
    if (studioMediaRecorder?.state === "recording") duoAnimationId = requestAnimationFrame(update);
  }
  update();
}

export function stopDuoLevelMonitor() { if (duoAnimationId) cancelAnimationFrame(duoAnimationId); if ($("duoMic1Level")) $("duoMic1Level").style.width = "0%"; if ($("duoMic2Level")) $("duoMic2Level").style.width = "0%"; }

export function stopStudioRecording() {
  if (studioMediaRecorder?.state !== "inactive") studioMediaRecorder.stop();
  if (studioStream) studioStream.getTracks().forEach(t => t.stop());
  if (studioStream2) { studioStream2.getTracks().forEach(t => t.stop()); studioStream2 = null; }
  if (duoAudioContext) { duoAudioContext.close(); duoAudioContext = null; }
  if ($("duoIndicator")) $("duoIndicator").style.display = "none";
  if ($("player")) $("player").pause();
}

export function redoStudioRecording() { studioChunks = []; studioRecordedBlob = null; if ($("voicePlayer")) $("voicePlayer").src = ""; if ($("studioStatus")) $("studioStatus").textContent = "Estado: grabación eliminada."; }

export async function saveStudioRecording() {
  if (!studioRecordedBlob) { alert("⚠️ No hay grabación"); return; }
  await addLibraryItem({ name: studioTrackFileName ? `Voz - ${studioTrackFileName}` : "Grabación de voz", type: "voz", date: new Date().toISOString(), audioBlob: studioRecordedBlob });
  alert("🚀 ¡Grabación guardada!");
}

export async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  const tracks = await getLibraryItemsByType("pista");
  tracks.forEach(t => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; select.appendChild(o); });
}

export async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect"), player = $("player"), status = $("studioStatus");
  const item = await getLibraryItemById(Number(select.value));
  if (item) { studioSelectedTrackName = item.name; studioSelectedTrackBlob = item.audioBlob; player.src = URL.createObjectURL(item.audioBlob); status.textContent = `Pista cargada: ${item.name}`; }
}
export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;
  const todos = await getAllLibraryItems();
  const filtered = todos.filter(i => i.type?.toLowerCase() === "voz" || i.type?.toLowerCase() === "grabacion" || i.type?.toLowerCase() === "grabación");
  filtered.forEach(v => { const o = document.createElement("option"); o.value = v.id; o.textContent = v.name; select.appendChild(o); });
}

export async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect"), player = $("selectedVoicePlayer"), status = $("selectedVoiceStatus"), text = $("lyricsText");
  const item = await getLibraryItemById(Number(select.value));
  if (!item) return;

  selectedVoiceBlob = item.audioBlob || item.audioData; selectedVoiceId = item.id;
  player.src = URL.createObjectURL(selectedVoiceBlob);
  status.textContent = `Estado: voz seleccionada -> ${item.name}`;
  console.log("📥 [Estudio] Voz del cantante cargada:", item.name);

  if (Array.isArray(item.transcription) && item.transcription.length > 0) {
    console.log("♻️ [Estudio] ¡Reutilizando transcripción existente para evitar re-transcribir con la API!");
    baseTranscriptionSegments = item.transcription.map(s => buildWordTimingFromSegment(s));
    transcriptionSegments = baseTranscriptionSegments;
    
    const karaokeModulo = await import('./karaoke.js');
    if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
      karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
    }
    if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
      karaokeModulo.cargarLetrasEnMonitor();
    }
    if (text) text.value = transcriptionSegments.map(s => s.text || "").join("\n").trim();
    status.textContent = "Estado: Voz seleccionada (Letras cargadas de memoria ⚡)";
  } else {
    baseTranscriptionSegments = [];
    transcriptionSegments = [];
    if (text) text.value = "";
  }
}

export async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) { alert("⚠️ Primero selecciona y carga una voz desde Biblioteca"); return; }
  const status = $("selectedVoiceStatus"), lyricsText = $("lyricsText");
  try {
    status.textContent = "Estado: Preparando audio (cortando en porciones)...";
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await selectedVoiceBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const CHUNK_SECONDS = 25, sampleRate = audioBuffer.sampleRate, totalSamples = audioBuffer.length, samplesPerChunk = CHUNK_SECONDS * sampleRate;
    let fullSegments = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      const chunkNumber = Math.floor(start / samplesPerChunk) + 1;
      const totalChunks = Math.ceil(totalSamples / samplesPerChunk);
      status.textContent = `Estado: Transcribiendo parte ${chunkNumber} de ${totalChunks}...`;

      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: await blobToBase64(audioBufferToWav(audioBuffer, start, end)) }) });
      
      if (!response.ok) {
        const errorTextoServidor = await response.text().catch(() => "Sin mensaje de texto");
        console.error(`❌ [estudio.js] El Servidor de Vercel rechazó la petición. Código HTTP: [${response.status}]`);
        throw new Error(`Fallo en Servidor remoto (Código ${response.status}): ${errorTextoServidor}`);
      }
      
      const result = await response.json();
      const palabrasProhibidas = ["Amara", "Subtítulos", "subtítulos", "Almorzo", "Suscribete", "comunidad"];
      const timeOffset = start / sampleRate;
      
      (result.segments || []).forEach(seg => {
        const segText = (seg?.text || "").trim();
        if (!segText) return;
        const esFantasma = palabrasProhibidas.some(p => segText.toLowerCase().includes(p.toLowerCase()));
        if (esFantasma) return;
        
        fullSegments.push(buildWordTimingFromSegment({ start: Number(seg.start || 0) + timeOffset, end: Number(seg.end || 0) + timeOffset, text: segText }));
      });
    }

    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);
    
    const karaokeModulo = await import('./karaoke.js');
    if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
      karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
    }
    if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
      karaokeModulo.cargarLetrasEnMonitor();
    }
    
    if (lyricsText) lyricsText.value = transcriptionSegments.map(l => l.text).join("\n");
    
    // Auto-generación y persistencia unificada
    if (selectedVoiceId) {
      await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments }).catch(() => {});
    }
    status.textContent = "Estado: Transcripción completada y guardada en texto ✅";
  } catch (err) { 
    console.error(err); 
    status.textContent = "Estado: Error en la transcripción ❌"; 
  }
}
export async function applyCorrectedLyrics() {
  const text = $("lyricsText"); if (!text || !text.value.trim()) return;
  const lines = text.value.split("\n").map(l => l.trim()).filter(Boolean);
  let palabraIndex = 0, todasLasPalabras = [];
  baseTranscriptionSegments.forEach(s => { if (s.words) todasLasPalabras.push(...s.words); });

  const rebuilt = lines.map(line => {
    const words = line.split(/\s+/).filter(Boolean);
    const timed = words.map(w => {
      const base = todasLasPalabras[palabraIndex] || todasLasPalabras[todasLasPalabras.length - 1];
      palabraIndex++;
      return { word: w, start: base ? base.start : 0, end: base ? base.end : 1, pitch: base ? base.pitch : 0, note: base ? base.note : "C4" };
    });
    return { start: timed.length ? timed[0].start : 0, end: timed.length ? timed[timed.length-1].end : 0, text: line, words: timed };
  });

  baseTranscriptionSegments = rebuilt; transcriptionSegments = rebuilt;
  
  const karaokeModulo = await import('./karaoke.js');
  if (typeof karaokeModulo.renderKaraokeLyrics === "function") {
    karaokeModulo.renderKaraokeLyrics(transcriptionSegments);
  }
  if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
    karaokeModulo.cargarLetrasEnMonitor();
  }
  if (selectedVoiceId) {
    await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
    console.log("💾 [estudio.js] ¡Cambios de texto guardados en IndexedDB!");
  }
  alert("📝 ¡Letra corregida aplicada con éxito!");
}

export function startTapSync() {
  const text = $("lyricsText"), player = $("selectedVoicePlayer");
  if (!text?.value.trim() || !player?.src) { alert("⚠️ Carga voz y letra primero"); return; }
  tapSyncLines = text.value.split("\n").map(l => l.trim()).filter(Boolean);
  tapSyncTimestamps = []; tapSyncCurrentIndex = 0; tapSyncMode = true;
  $("startTapSyncBtn").style.style.display = "none"; $("cancelTapSyncBtn").style.display = "inline-block"; $("tapSyncActive").style.display = "block"; $("tapSyncResult").style.display = "none";
  updateTapSyncDisplay(); player.currentTime = 0; player.play();
  document.removeEventListener("keydown", handleTapSyncKeypress); document.addEventListener("keydown", handleTapSyncKeypress);
}

function handleTapSyncKeypress(e) { if (tapSyncMode && (e.code === "Space" || e.key === " ")) { e.preventDefault(); recordTap(); } }

export function recordTap() {
  const player = $("selectedVoicePlayer"); if (!tapSyncMode || !player) return;
  tapSyncTimestamps.push(player.currentTime);
  console.log(`🎵 [estudio.js] TAP REGISTRADO -> Línea ${tapSyncCurrentIndex + 1}: "${tapSyncLines[tapSyncCurrentIndex]}" a los ${player.currentTime.toFixed(2)}s`);
  tapSyncCurrentIndex++;
  
  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    tapSyncMode = false; player.pause(); document.removeEventListener("keydown", handleTapSyncKeypress);
    $("tapSyncActive").style.display = "none"; $("tapSyncResult").style.display = "block"; $("cancelTapSyncBtn").style.display = "none";
  } else updateTapSyncDisplay();
}

export function updateTapSyncDisplay() { if ($("tapCurrentLine")) $("tapCurrentLine").textContent = tapSyncLines[tapSyncCurrentIndex]; if ($("tapProgress")) $("tapProgress").textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`; }
export function cancelTapSync() { tapSyncMode = false; $("selectedVoicePlayer")?.pause(); document.removeEventListener("keydown", handleTapSyncKeypress); $("startTapSyncBtn").style.display = "inline-block"; $("cancelTapSyncBtn").style.display = "none"; $("tapSyncActive").style.display = "none"; $("tapSyncResult").style.display = "none"; }

export async function applyTapSync() {
  const player = $("selectedVoicePlayer"), total = player ? player.duration : 0;
  const segments = tapSyncLines.map((line, i) => {
    const start = tapSyncTimestamps[i] || 0;
    let end = tapSyncTimestamps[i+1] || total || start + 3;
    if (end - start > 1.2) end = start + Math.min(end - start, line.split(/\s+/).length * 0.45);
    return buildWordTimingFromSegment({ start, end, text: line });
  });
  
  baseTranscriptionSegments = segments; 
  transcriptionSegments = segments;
  window.transcriptionSegments = segments; // Inyección inmediata en la memoria caché global

  const pistaInstrumentalActiva = studioSelectedTrackBlob || studioTrackBlob;
  const nombrePistaActiva = studioSelectedTrackName || studioTrackFileName || "Canción Sincronizada";

  if (pistaInstrumentalActiva) {
    try {
      console.log(`💾 [estudio.js] Guardando proyecto unificado: "Karaoke - ${nombrePistaActiva}" con base instrumental pura.`);
      await addLibraryItem({ 
        name: `Karaoke - ${nombrePistaActiva}`, 
        type: "karaoke", 
        audioBlob: pistaInstrumentalActiva, 
        date: new Date().toLocaleString("es-ES"), 
        transcription: segments, 
        metadata: { title: nombrePistaActiva, origen: "Estudio Sync Master" } 
      });
    } catch (err) { console.error("❌ Error guardando karaoke en BD:", err); }
  }

  // --- EXCLUSIVO: REDIRECCIÓN AUTOMÁTICA MAESTRA AL MONITOR DE KARAOKE ---
  cancelTapSync();
  alert("🎉 ¡Sincronización manual completada con éxito!\n\nSe ha creado tu proyecto unificado de Karaoke. La aplicación te redirigirá automáticamente a la pestaña de Karaoke y activará las partituras en pantalla de inmediato para empezar a cantar.");

  const { showTab } = await import('../script.js');
  const karaokeModulo = await import('./karaoke.js');

  if (typeof karaokeModulo.cargarLetrasEnMonitor === "function") {
    karaokeModulo.cargarLetrasEnMonitor();
  }
  
  // Cambiamos al usuario de entorno visual
  if (typeof showTab === "function") {
    await showTab("karaoke");
  }

  // Forzamos el acople del reproductor de sonido en la nueva pestaña de forma inmediata
  const kTrack = document.getElementById("karaokeTrack");
  if (kTrack && pistaInstrumentalActiva) {
    kTrack.src = URL.createObjectURL(pistaInstrumentalActiva);
    kTrack.dataset.name = nombrePistaActiva;
    document.getElementById("karaokeStatus").textContent = `Estado: Proyecto "${nombrePistaActiva}" listo. ¡Inicia grabación!`;
  }
  
  if (typeof karaokeModulo.loadMyKaraokeSongs === "function") {
    await karaokeModulo.loadMyKaraokeSongs().catch(() => {});
  }
}

export function redoTapSync() { $("tapSyncResult").style.display = "none"; startTapSync(); }
