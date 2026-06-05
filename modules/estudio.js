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
