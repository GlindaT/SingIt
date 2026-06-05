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
