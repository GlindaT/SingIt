import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById, updateLibraryItem, addLibraryItem, getAllLibraryItems } from './biblioteca.js';

// ==========================================
// 1. VARIABLES DE ESTADO LOCALES ENCAPSULADAS
// ==========================================
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

let studioTrackFileName = null;
let studioTrackBlob = null;
let studioTrackId = null;
let studioSelectedTrackName = null;
let studioSelectedTrackBlob = null;
let studioSelectedTrackId = null;

let selectedVoiceBlob = null;
let selectedVoiceId = null;

let transcriptionSegments = [];
let baseTranscriptionSegments = [];

let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

// ==========================================
// 2. SUBRUTINAS MATEMÁTICAS Y CONVERSORES COMPARTIDOS (LIBERADOS)
// ==========================================

export function setTranscriptionSegments(data) {
  baseTranscriptionSegments = data;
  transcriptionSegments = data;
}

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
        const base64String = reader.result.split(",")[1];
        resolve(base64String);
      } else {
        resolve("");
      }
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

function audioBufferToWav(buffer, startSample, endSample) {
  const originalSampleRate = buffer.sampleRate;
  const targetSampleRate = 16000; 
  const numChannels = buffer.numberOfChannels;
  const chanData0 = buffer.getChannelData(0);
  const chanData1 = numChannels > 1 ? buffer.getChannelData(1) : null;
  
  const originalChunkLength = endSample - startSample;
  const duration = originalChunkLength / originalSampleRate;
  const targetLength = Math.floor(duration * targetSampleRate);
  
  const bufferLength = targetLength * 2 + 44; 
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  view.setUint32(0, 0x46464952, true); 
  view.setUint32(4, bufferLength - 8, true);
  view.setUint32(8, 0x45564157, true); 
  view.setUint32(12, 0x20746d66, true); 
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true);        
  view.setUint16(22, 1, true); // MONO        
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true); 
  view.setUint16(32, 2, true);        
  view.setUint16(34, 16, true);       
  view.setUint32(36, 0x61746164, true); 
  view.setUint32(40, targetLength * 2, true);

  let offset = 44;
  for (let i = 0; i < targetLength; i++) {
    const originalTime = i / targetSampleRate;
    const originalSampleIndex = startSample + Math.floor(originalTime * originalSampleRate);
    if (originalSampleIndex >= endSample) break;
    
    let sample = chanData0[originalSampleIndex];
    if (chanData1) sample = (sample + chanData1[originalSampleIndex]) / 2; 
    
    sample = Math.max(-1, Math.min(1, sample)); 
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
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

// ==========================================
// 3. CAPA DE EVENTOS VISUALES Y REPRODUCCIÓN
// ==========================================

export function cargarAudioEstudio(e) {
  const file = e.target.files[0];
  if (!file) return;
  studioTrackFileName = file.name; studioTrackBlob = file; studioTrackId = null;
  const player = $("player"); if (player) player.src = URL.createObjectURL(file);
  const status = $("studioStatus"); if (status) status.textContent = `Estado: pista cargada (${file.name})`;
}

export function playTrack() { const player = $("player"); if (player && player.src) player.play(); else alert("⚠️ Primero sube una pista"); }
export function pauseTrack() { const player = $("player"); if (player) player.pause(); }
export function stopTrack() { const player = $("player"); if (player) { player.pause(); player.currentTime = 0; } }

// ==========================================
// 4. SISTEMA DE GRABACIÓN MULTI-MIC DE VOZ
// ==========================================

export async function startStudioRecording() {
  try {
    const player = $("player"); const isDuo = $("micCount")?.value === "2";
    studioChunks = []; studioRecordedBlob = null;
    if ($("voicePlayer")) $("voicePlayer").src = "";
    if ($("studioStatus")) $("studioStatus").textContent = "Estado: preparando grabación...";

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
      if ($("studioStatus")) $("studioStatus").textContent = "Estado: grabación lista";
      stopDuoLevelMonitor();
    };

    studioMediaRecorder.start();
    if (player?.src) { player.currentTime = 0; player.play(); }
    if ($("studioStatus")) $("studioStatus").textContent = "Estado: 🔴 Grabando voz activada...";
  } catch (err) { console.error(err); }
}

export function startDuoLevelMonitor() {
  const l1 = $("duoMic1Level"), l2 = $("duoMic2Level");
  function update() {
    if (duoAnalyser1 && l1) { 
      const d1 = new Uint8Array(duoAnalyser1.frequencyBinCount); 
      duoAnalyser1.getByteFrequencyData(d1); 
      l1.style.width = Math.min(100, (d1.reduce((a,b)=>a+b,0)/d1.length/128)*100) + "%"; 
    }
    if (duoAnalyser2 && l2) { 
      const d2 = new Uint8Array(duoAnalyser2.frequencyBinCount); 
      duoAnalyser2.getByteFrequencyData(d2); 
      l2.style.width = Math.min(100, (d2.reduce((a,b)=>a+b,0)/d2.length/128)*100) + "%"; 
    }
    if (studioMediaRecorder?.state === "recording") duoAnimationId = requestAnimationFrame(update);
  }
  update();
}

export function stopDuoLevelMonitor() { 
  if (duoAnimationId) cancelAnimationFrame(duoAnimationId); 
  if ($("duoMic1Level")) $("duoMic1Level").style.width = "0%"; 
  if ($("duoMic2Level")) $("duoMic2Level").style.width = "0%"; 
}

export function stopStudioRecording() {
  if (studioMediaRecorder?.state !== "inactive") studioMediaRecorder.stop();
  if (studioStream) studioStream.getTracks().forEach(t => t.stop());
  if (studioStream2) { studioStream2.getTracks().forEach(t => t.stop()); studioStream2 = null; }
  if (duoAudioContext) { duoAudioContext.close(); duoAudioContext = null; }
  if ($("duoIndicator")) $("duoIndicator").style.display = "none";
  if ($("player")) $("player").pause();
}

export function redoStudioRecording() { 
  studioChunks = []; 
  studioRecordedBlob = null; 
  if ($("voicePlayer")) $("voicePlayer").src = ""; 
  if ($("studioStatus")) $("studioStatus").textContent = "Estado: grabación eliminada."; 
}

export async function saveStudioRecording() {
  if (!studioRecordedBlob) { alert("⚠️ No hay grabación"); return; }
  await addLibraryItem({ 
    name: studioTrackFileName ? `Voz - ${studioTrackFileName}` : "Grabación de voz", 
    type: "voz", 
    date: new Date().toISOString(), 
    audioBlob: studioRecordedBlob 
  });
  alert("🚀 ¡Grabación guardada!");
}

// ==========================================
// 5. CARGA DE RECURSOS DESDE INDEXEDDB
// ==========================================

export async function loadTrackOptionsInStudio() {
  const select = $("studioTrackSelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una pista desde Biblioteca</option>`;
  const tracks = await getLibraryItemsByType("pista");
  tracks.forEach(t => { 
    const o = document.createElement("option"); 
    o.value = t.id; 
    o.textContent = t.name; 
    select.appendChild(o); 
  });
}

export async function loadSelectedTrackFromLibraryStudio() {
  const select = $("studioTrackSelect"), player = $("player"), status = $("studioStatus");
  const item = await getLibraryItemById(Number(select.value));
  if (item) { 
    studioTrackFileName = item.name; 
    studioTrackBlob = item.audioBlob; 
    player.src = URL.createObjectURL(item.audioBlob); 
    status.textContent = `Pista cargada: ${item.name}`; 
  }
}

export async function loadVoiceOptionsInStudio() {
  const select = $("voiceLibrarySelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una voz guardada</option>`;
  const todos = await getAllLibraryItems();
  const filtered = todos.filter(i => i.type?.toLowerCase() === "voz" || i.type?.toLowerCase() === "grabacion" || i.type?.toLowerCase() === "grabación");
  filtered.forEach(v => { 
    const o = document.createElement("option"); 
    o.value = v.id; 
    o.textContent = v.name; 
    select.appendChild(o); 
  });
}

export async function loadSelectedVoiceFromLibrary() {
  const select = $("voiceLibrarySelect"), player = $("selectedVoicePlayer"), status = $("selectedVoiceStatus"), text = $("lyricsText");
  const item = await getLibraryItemById(Number(select.value));
  if (!item) return;

  selectedVoiceBlob = item.audioBlob || item.audioData; selectedVoiceId = item.id;
  player.src = URL.createObjectURL(selectedVoiceBlob);
  status.textContent = `Voz cargada: ${item.name}`;

  if (Array.isArray(item.transcription) && item.transcription.length > 0) {
    baseTranscriptionSegments = item.transcription.map(s => buildWordTimingFromSegment(s));
    transcriptionSegments = baseTranscriptionSegments;
    const { renderKaraokeLyrics, cargarLetrasEnMonitor } = await import('./karaoke.js');
    renderKaraokeLyrics(transcriptionSegments); cargarLetrasEnMonitor();
    if (text) text.value = transcriptionSegments.map(s => s.text || "").join("\n");
  }
}

// ==========================================
// 6. NÚCLEO DE LLAMADA WHISPER IA (COMPRIMIDO)
// ==========================================

export async function transcribeSelectedVoice() {
  if (!selectedVoiceBlob) { alert("⚠️ Carga una voz primero"); return; }
  const status = $("selectedVoiceStatus"), lyricsText = $("lyricsText");
  try {
    status.textContent = "Estado: Reduciendo peso a 16kHz Mono... ⏳";
    const audioBuffer = await new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(await selectedVoiceBlob.arrayBuffer());
    const CHUNK_SECONDS = 20, sampleRate = audioBuffer.sampleRate, totalSamples = audioBuffer.length, samplesPerChunk = CHUNK_SECONDS * sampleRate;
    let fullSegments = [];

    for (let start = 0; start < totalSamples; start += samplesPerChunk) {
      const end = Math.min(start + samplesPerChunk, totalSamples);
      status.textContent = `Estado: Transcribiendo con Whisper IA (${Math.floor(start/samplesPerChunk)+1} / ${Math.ceil(totalSamples/samplesPerChunk)})... 🚀`;

      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: await blobToBase64(audioBufferToWav(audioBuffer, start, end)) }) });
      if (!response.ok) throw new Error("Error en servidor");
      
      const result = await response.json();
      const timeOffset = start / sampleRate;
      (result.segments || []).forEach(seg => {
        if (!seg.text || ["amara", "subtítulos"].some(p => seg.text.toLowerCase().includes(p))) return;
        fullSegments.push(buildWordTimingFromSegment({ start: Number(seg.start || 0) + timeOffset, end: Number(seg.end || 0) + timeOffset, text: seg.text.trim(), words: seg.words ? seg.words.map(w => ({ ...w, start: w.start + timeOffset, end: w.end + timeOffset })) : null }));
      });
    }

    baseTranscriptionSegments = fullSegments;
    transcriptionSegments = splitSegmentsIntoKaraokeLines(baseTranscriptionSegments, 6);
    const { renderKaraokeLyrics, cargarLetrasEnMonitor } = await import('./karaoke.js');
    renderKaraokeLyrics(transcriptionSegments); cargarLetrasEnMonitor();
    if (lyricsText) lyricsText.value = transcriptionSegments.map(l => l.text).join("\n");
    status.textContent = "Estado: Transcripción completada ✅";
  } catch (err) { console.error(err); status.textContent = "Estado: Error ❌"; }
}

// ==========================================
// 7. CORRECCIÓN Y SINCRONIZACIÓN MANUAL (TAPS)
// ==========================================

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
    return { start: timed.length ? timed.start : 0, end: timed.length ? timed[timed.length-1].end : 0, text: line, words: timed };
  });

  baseTranscriptionSegments = rebuilt; transcriptionSegments = rebuilt;
  const { renderKaraokeLyrics, cargarLetrasEnMonitor } = await import('./karaoke.js');
  renderKaraokeLyrics(transcriptionSegments); cargarLetrasEnMonitor();
  if (selectedVoiceId) await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
}

export function startTapSync() {
  const text = $("lyricsText"), player = $("selectedVoicePlayer");
  if (!text?.value.trim() || !player?.src) { alert("⚠️ Carga voz y letra primero"); return; }
  tapSyncLines = text.value.split("\n").map(l => l.trim()).filter(Boolean);
  tapSyncTimestamps = []; tapSyncCurrentIndex = 0; tapSyncMode = true;
  $("startTapSyncBtn").style.display = "none"; $("cancelTapSyncBtn").style.display = "inline-block"; $("tapSyncActive").style.display = "block"; $("tapSyncResult").style.display = "none";
  updateTapSyncDisplay(); player.currentTime = 0; player.play();
  document.removeEventListener("keydown", handleTapSyncKeypress); document.addEventListener("keydown", handleTapSyncKeypress);
}

function handleTapSyncKeypress(e) { if (tapSyncMode && (e.code === "Space" || e.key === " ")) { e.preventDefault(); recordTap(); } }

export function recordTap() {
  const player = $("selectedVoicePlayer"); if (!tapSyncMode || !player) return;
  tapSyncTimestamps.push(player.currentTime); tapSyncCurrentIndex++;
  if (tapSyncCurrentIndex >= tapSyncLines.length) {
    tapSyncMode = false; player.pause(); document.removeEventListener("keydown", handleTapSyncKeypress);
    $("tapSyncActive").style.display = "none"; $("tapSyncResult").style.display = "block"; $("cancelTapSyncBtn").style.display = "none";
  } else updateTapSyncDisplay();
}

export function updateTapSyncDisplay() { 
  if ($("tapCurrentLine")) $("tapCurrentLine").textContent = tapSyncLines[tapSyncCurrentIndex]; 
  if ($("tapProgress")) $("tapProgress").textContent = `${tapSyncCurrentIndex} / ${tapSyncLines.length} líneas`; 
}

export function cancelTapSync() { 
  tapSyncMode = false; 
  $("selectedVoicePlayer")?.pause(); 
  document.removeEventListener("keydown", handleTapSyncKeypress); 
  if ($("startTapSyncBtn")) $("startTapSyncBtn").style.display = "inline-block"; 
  if ($("cancelTapSyncBtn")) $("cancelTapSyncBtn").style.display = "none"; 
  if ($("tapSyncActive")) $("tapSyncActive").style.display = "none"; 
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "none"; 
}

export async function applyTapSync() {
  const player = $("selectedVoicePlayer");
  const total = player ? player.duration : 0;
  
  const segments = tapSyncLines.map((line, i) => {
    const start = tapSyncTimestamps[i] || 0;
    let end = tapSyncTimestamps[i+1] || total || start + 3;
    if (end - start > 1.2) {
      end = start + Math.min(end - start, line.split(/\s+/).length * 0.45);
    }
    return buildWordTimingFromSegment({ start, end, text: line });
  });

  baseTranscriptionSegments = segments; 
  transcriptionSegments = segments;

  if (studioSelectedTrackBlob) {
    await addLibraryItem({ 
      name: `Karaoke - ${studioSelectedTrackName || "Sin título"}`, 
      type: "karaoke", 
      audioBlob: studioSelectedTrackBlob, 
      date: new Date().toLocaleString("es-ES"), 
      transcription: segments, 
      metadata: { title: studioSelectedTrackName } 
    });
  }

  const { renderKaraokeLyrics, cargarLetrasEnMonitor } = await import('./karaoke.js');
  renderKaraokeLyrics(transcriptionSegments); 
  cargarLetrasEnMonitor();

  if (selectedVoiceId) {
    await updateLibraryItem(selectedVoiceId, { transcription: baseTranscriptionSegments });
  }
  
  cancelTapSync();
}

export function redoTapSync() { 
  if ($("tapSyncResult")) $("tapSyncResult").style.display = "none"; 
  startTapSync(); 
}
