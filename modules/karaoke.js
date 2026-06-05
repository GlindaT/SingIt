import { $ } from '../script.js';
import { aplicarCadenaDeAudioKaraoke } from './estudio.js'; 
import { getLibraryItemsByType, getLibraryItemById, deleteLibraryItemFromDB } from './biblioteca.js';

// Variables estáticas y de control encapsuladas dentro del módulo
const staticBufferMic1 = new Float32Array(2048);
const staticBufferMic2 = new Float32Array(2048);

let karaokeMediaRecorder = null;
let karaokeStream = null;
let karaokeStream2 = null;
let karaokeChunks = [];
let karaokeRecordedBlob = null;
let karaokeSelectedTrackBlob = null;
let karaokeSelectedTrackName = "Pista";
let karaokeDuoAudioContext = null;
let karaokeDuoAnalyser1 = null;
let karaokeDuoAnalyser2 = null;
let karaokeDuoAnimationId = null;
let currentVolNode1 = null;
let currentVolNode2 = null;
let lineaLiveActivaIndexCache = -1;
let lineaActivaIndexCache = -1;

export function reconstruirFraseDesdeWords(segmento) {
  if (!segmento) return "";
  const listaPalabras = Array.isArray(segmento.words) ? segmento.words : [];
  if (listaPalabras.length === 0 && segmento.text) return segmento.text.trim(); 

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

export class KaraokeCanvasRenderer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas con ID ${canvasId} no encontrado`);
    this.ctx = this.canvas.getContext('2d');
    
    this.options = { maxFrameRate: options.maxFrameRate || 30, cacheSize: options.cacheSize || 100, ...options };
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / this.options.maxFrameRate;
    this.noteYCache = new Map();
    
    this.pentagramTop = 30;
    this.midiMin = 48; // C3
    this.midiMax = 84; // C6
    this.midiRange = this.midiMax - this.midiMin;
    this.lineX = 50; 
  }

  shouldRender() {
    const now = performance.now();
    if (now - this.lastFrameTime < this.frameInterval) return false;
    this.lastFrameTime = now;
    return true;
  }

  midiToY(midi) {
    let m = midi || 60;
    if (this.noteYCache.has(m)) return this.noteYCache.get(m);
    if (m < this.midiMin) m = this.midiMin;
    if (m > this.midiMax) m = this.midiMax;

    const pentagramHeight = this.canvas.height - 90;
    const normalized = (this.midiMax - m) / this.midiRange;
    const y = this.pentagramTop + normalized * pentagramHeight;

    if (this.noteYCache.size > this.options.cacheSize) {
      this.noteYCache.delete(this.noteYCache.keys().next().value);
    }
    this.noteYCache.set(m, y);
    return y;
  }

  frequencyToMidi(freq) {
    if (freq <= 0) return 0;
    return Math.round(12 * Math.log2(freq / 440) + 69);
  }

  obtenerPaletaTema() {
    const temaActual = localStorage.getItem("singIt_stage") || "theme-clasico";
    let config = { fondo: "#111827", lineas: "#333333", etiquetas: "#666666", barraFutura: "#1e40af", bordeFuturo: "#3b82f6" };

    if (temaActual === "theme-moderno") {
      config = { fondo: "#082f49", lineas: "rgba(6, 182, 212, 0.2)", etiquetas: "#06b6d4", barraFutura: "#1e3a8a", bordeFuturo: "#06b6d4" };
    } else if (temaActual === "theme-disco") {
      config = { fondo: "#2e1065", lineas: "rgba(219, 39, 119, 0.25)", etiquetas: "#facc15", barraFutura: "#701a75", bordeFuturo: "#db2777" };
    } else if (temaActual === "theme-acustico") {
      config = { fondo: "#451a03", lineas: "rgba(120, 53, 15, 0.4)", etiquetas: "#fcd34d", barraFutura: "#78350f", bordeFuturo: "#b45309" };
    } else if (temaActual === "theme-fiesta") {
      const hue = (Date.now() / 20) % 360;
      config = {
        fondo: `hsl(${hue}, 40%, 12%)`, lineas: "rgba(255, 255, 255, 0.15)", etiquetas: "#ff007f",
        barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`, bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)`
      };
    } else if (temaActual === "theme-retrowave") {
      config = { fondo: "#1e0b36", lineas: "rgba(255, 0, 127, 0.25)", etiquetas: "#38bdf8", barraFutura: "#4c1d95", bordeFuturo: "#ff007f" };
    }
    return config;
  }

  render(currentTime, currentFreq, currentFreq2, transcriptionSegments) {
    if (!this.shouldRender()) return;

    const paleta = this.obtenerPaletaTema();
    const pentagramBottom = this.canvas.height - 60;
    const pentagramHeight = pentagramBottom - this.pentagramTop;

    window.pitchHistoryMic1?.push(currentFreq > 0 ? currentFreq : null);
    if (window.pitchHistoryMic1?.length > 60) window.pitchHistoryMic1.shift();

    window.pitchHistoryMic2?.push(currentFreq2 > 0 ? currentFreq2 : null);
    if (window.pitchHistoryMic2?.length > 60) window.pitchHistoryMic2.shift();

    this.ctx.fillStyle = paleta.fondo;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.strokeStyle = paleta.lineas; 
    this.ctx.lineWidth = 1;
    const numLines = 10;
    for (let i = 0; i <= numLines; i++) {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i;
      this.ctx.beginPath(); this.ctx.moveTo(35, y); this.ctx.lineTo(this.canvas.width, y); this.ctx.stroke();
    }

    this.ctx.fillStyle = paleta.etiquetas; 
    this.ctx.font = "11px sans-serif"; this.ctx.textAlign = "right";
    const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
    noteLabels.forEach((label, i) => {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i + 4;
      this.ctx.fillText(label, 28, y);
    });

    if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
      const timeWindowStart = currentTime - 1;
      const timeWindowEnd = currentTime + 5;
      const pixelsPerSecond = (this.canvas.width - 50) / 6;

      this.ctx.strokeStyle = "#ef4444"; this.ctx.lineWidth = 2;
      this.ctx.beginPath(); this.ctx.moveTo(this.lineX, this.pentagramTop); this.ctx.lineTo(this.lineX, pentagramBottom); this.ctx.stroke();

      transcriptionSegments.forEach((segment) => {
        const words = Array.isArray(segment.words) ? segment.words : [];
        words.forEach((word) => {
          if (word.end < timeWindowStart || word.start > timeWindowEnd) return;
          
          const wordStartX = this.lineX + (word.start - currentTime) * pixelsPerSecond;
          const wordEndX = this.lineX + (word.end - currentTime) * pixelsPerSecond;
          const barWidth = Math.max(wordEndX - wordStartX, 35);
          
          const midi = word.midi || segment.midi || 60;
          const barY = this.midiToY(midi);
          const barHeight = 20;
          
          const isActive = currentTime >= word.start && currentTime <= word.end;
          const isPast = currentTime > word.end;
          
          let isCorrect = false;
          if (isActive) {
            if (currentFreq && currentFreq > 0) {
              const userMidi1 = this.frequencyToMidi(currentFreq);
              if (Math.abs(userMidi1 - midi) <= 1) isCorrect = true; 
            }
            if (currentFreq2 && currentFreq2 > 0) {
              const userMidi2 = this.frequencyToMidi(currentFreq2);
              if (Math.abs(userMidi2 - midi) <= 1) isCorrect = true;
            }
          }
          
          let barColor, textColor, borderColor;
          if (isPast) {
            barColor = "#4b5563"; textColor = "#9ca3af"; borderColor = "#6b7280";
          } else if (isActive) {
            if (isCorrect) {
              barColor = "#22c55e"; textColor = "#ffffff"; borderColor = "#4ade80";
            } else {
              barColor = "#3b82f6"; textColor = "#ffffff"; borderColor = "#60a5fa";
            }
          } else {
            barColor = paleta.barraFutura; textColor = "rgba(255, 255, 255, 0.7)"; borderColor = paleta.bordeFuturo;
          }
          
          this.ctx.fillStyle = barColor; this.ctx.beginPath();
          this.ctx.roundRect(wordStartX, barY - barHeight/2, barWidth, barHeight, 6); this.ctx.fill();
          this.ctx.strokeStyle = borderColor; this.ctx.lineWidth = isActive ? 2 : 1; this.ctx.stroke();
          
          this.ctx.fillStyle = textColor; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
          let displayWord = word.word || word.text || "";
          if (displayWord.length > 8) this.ctx.font = isActive ? "bold 11px sans-serif" : "10px sans-serif";
          else this.ctx.font = isActive ? "bold 13px sans-serif" : "12px sans-serif";
          
          this.ctx.fillText(displayWord, wordStartX + barWidth/2, barY);
        });
      });

      if (window.pitchHistoryMic1 && window.pitchHistoryMic1.length > 0) {
        this.ctx.beginPath(); this.ctx.strokeStyle = "rgba(250, 204, 21, 0.6)"; this.ctx.lineWidth = 4;
        let started1 = false;
        window.pitchHistoryMic1.forEach((freq, i) => {
          if (freq && freq > 0) {
            const y = this.midiToY(this.frequencyToMidi(freq));
            const x = this.lineX - (window.pitchHistoryMic1.length - i) * 2.5;
            if (x >= 0) {
              if (!started1) { this.ctx.moveTo(x, y); started1 = true; } else { this.ctx.lineTo(x, y); }
            }
          } else { started1 = false; }
        });
        this.ctx.stroke();
      }

      if (currentFreq && currentFreq > 0) {
        const userY1 = this.midiToY(this.frequencyToMidi(currentFreq));
        this.ctx.beginPath(); this.ctx.fillStyle = "#facc15"; this.ctx.shadowBlur = 15; this.ctx.shadowColor = "#facc15";
        this.ctx.arc(this.lineX, userY1, 8, 0, Math.PI * 2); this.ctx.fill(); this.ctx.shadowBlur = 0;
      }
      if (window.pitchHistoryMic2 && window.pitchHistoryMic2.length > 0) {
        this.ctx.beginPath(); 
        this.ctx.strokeStyle = "rgba(6, 182, 212, 0.6)"; 
        this.ctx.lineWidth = 4;
        let started2 = false;
        window.pitchHistoryMic2.forEach((freq, i) => {
          if (freq && freq > 0) {
            const y = this.midiToY(this.frequencyToMidi(freq));
            const x = this.lineX - (window.pitchHistoryMic2.length - i) * 2.5;
            if (x >= 0) {
              if (!started2) { this.ctx.moveTo(x, y); started2 = true; } else { this.ctx.lineTo(x, y); }
            }
          } else { started2 = false; }
        });
        this.ctx.stroke();
      }

      if (currentFreq2 && currentFreq2 > 0) {
        const userY2 = this.midiToY(this.frequencyToMidi(currentFreq2));
        this.ctx.beginPath(); this.ctx.fillStyle = "#06b6d4"; this.ctx.shadowBlur = 15; this.ctx.shadowColor = "#06b6d4";
        this.ctx.arc(this.lineX + 6, userY2, 8, 0, Math.PI * 2); this.ctx.fill(); this.ctx.shadowBlur = 0;
      }

      // --- BANNER DE LETRAS INFERIORES SUB-TÍTULO ---
      const currentIndex = transcriptionSegments.findIndex(seg => currentTime >= seg.start && currentTime <= seg.end + 0.5);
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; 
      this.ctx.fillRect(0, this.canvas.height - 50, this.canvas.width, 50);

      if (currentIndex !== -1) {
        const currentSegment = transcriptionSegments[currentIndex];
        const textoActualLimpio = reconstruirFraseDesdeWords(currentSegment);
        this.ctx.fillStyle = "#ffffff"; this.ctx.font = "bold 16px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "top";
        this.ctx.fillText(textoActualLimpio, this.canvas.width / 2, this.canvas.height - 42);

        const nextSegment = transcriptionSegments[currentIndex + 1];
        if (nextSegment) {
          const textoProximoLimpio = reconstruirFraseDesdeWords(nextSegment);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)"; this.ctx.font = "12px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "bottom";
          this.ctx.fillText("Próximo: " + textoProximoLimpio, this.canvas.width / 2, this.canvas.height - 6);
        }
      } else {
        const upcomingSegment = transcriptionSegments.find(seg => seg.start > currentTime);
        if (upcomingSegment) {
          const textoProximoLimpio = reconstruirFraseDesdeWords(upcomingSegment);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)"; this.ctx.font = "14px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
          this.ctx.fillText("Próximo: " + textoProximoLimpio, this.canvas.width / 2, this.canvas.height - 25);
        }
      }

    } else {
      this.ctx.fillStyle = paleta.etiquetas; this.ctx.font = "15px sans-serif"; this.ctx.textAlign = "center";
      this.ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas en el pentagrama", this.canvas.width / 2, this.canvas.height / 2);
    }
  }

  handleResize() { this.noteYCache.clear(); }
}

/**
 * MOTOR DE CAPTURA ASÍNCRONO DÚO: Lee los datos del analizador y delega el cálculo matemático al Worker
 */
export async function startKaraokePitchDetection() {
    async function loop() {
        const track = $("karaokeTrack");
        
        if (!track || track.paused || track.ended || !window.isPitchDetectionRunning) {
            window.isPitchDetectionRunning = false;
            return;
        }

        const currentTime = track.currentTime;
        const { getAudioController } = await import('./audioController.js');
        const audioCtrl = getAudioController();
        const sampleRateSistema = window.karaokeDuoAudioContext?.sampleRate || 48000;

        let pitch1 = -1;
        if (window.karaokeDuoAnalyser1) {
            window.karaokeDuoAnalyser1.getFloatTimeDomainData(staticBufferMic1);
            let sum1 = 0;
            for (let i = 0; i < staticBufferMic1.length; i++) sum1 += staticBufferMic1[i] * staticBufferMic1[i];
            const rms1 = Math.sqrt(sum1 / staticBufferMic1.length);
            
            if (rms1 > 0.015) {
                pitch1 = await audioCtrl.detectPitch(staticBufferMic1, sampleRateSistema);
            }
        }

        let pitch2 = -1; 
        if (window.karaokeDuoAnalyser2) {
            window.karaokeDuoAnalyser2.getFloatTimeDomainData(staticBufferMic2);
            let sum2 = 0;
            for (let i = 0; i < staticBufferMic2.length; i++) sum2 += staticBufferMic2[i] * staticBufferMic2[i];
            const rms2 = Math.sqrt(sum2 / staticBufferMic2.length);

            if (rms2 > 0.015) {
                pitch2 = await audioCtrl.detectPitch(staticBufferMic2, sampleRateSistema);
            }
        }

        const { drawKaraokeMonitor } = await import('../script.js');
        if (typeof drawKaraokeMonitor === 'function') {
            drawKaraokeMonitor(currentTime, pitch1, pitch2);
        }

        if (window.isPitchDetectionRunning) {
            requestAnimationFrame(loop);
        }
    }

    window.isPitchDetectionRunning = true;
    loop();
}
// ====================================================================
// 📝 PARSEADORES DE MARCAS DE TIEMPO ULTRASTAR (.TXT)
// ====================================================================
function parseUltrastarTxt(content) {
  const lines = content.split('\n');
  const metadata = {};
  const notes = [];
  
  lines.forEach(line => {
    line = line.trim();
    if (line.startsWith('#')) {
      const match = line.match(/^#([^:]+):(.*)$/);
      if (match) metadata[match[1].toUpperCase()] = match[2].trim();
    } else if (line.startsWith(':') || line.startsWith('*') || line.startsWith('F')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        notes.push({
          type: parts[0],
          start: parseInt(parts[1], 10),
          length: parseInt(parts[2], 10),
          pitch: parseInt(parts[3], 10),
          word: parts.slice(4).join(' ')
        });
      }
    } else if (line.startsWith('-')) {
      const parts = line.split(/\s+/);
      notes.push({ type: '-', start: parseInt(parts[1] || '0', 10) });
    }
  });
  return { metadata, notes };
}

function ultrastarToSegments(parsed) {
  const bpm = parseFloat(parsed.metadata.BPM || '120');
  const gap = parseFloat(parsed.metadata.GAP || '0') / 1000; 
  const beatDuration = 60 / (bpm * 4); 

  let currentSegment = { start: null, end: null, text: "", words: [] };
  const segments = [];

  parsed.notes.forEach(note => {
    if (note.type === '-') {
      if (currentSegment.words.length > 0) {
        currentSegment.text = currentSegment.words.map(w => w.word).join(" ").trim();
        segments.push(currentSegment);
        currentSegment = { start: null, end: null, text: "", words: [] };
      }
      return;
    }

    const noteStartSec = gap + (note.start * beatDuration);
    const noteEndSec = noteStartSec + (note.length * beatDuration);

    if (currentSegment.start === null) currentSegment.start = noteStartSec;
    currentSegment.end = noteEndSec;

    currentSegment.words.push({
      word: note.word,
      start: noteStartSec,
      end: noteEndSec,
      midi: note.pitch + 60 
    });
  });

  if (currentSegment.words.length > 0) {
    currentSegment.text = currentSegment.words.map(w => w.word).join(" ").trim();
    segments.push(currentSegment);
  }
  return segments;
}

// ====================================================================
// 📥 SUBIDA DE INTERFAZ LOCAL Y ASOCIACIÓN DE COMPONENTES VISUALES
// ====================================================================
export function cargarPistaKaraoke(e) {
  const file = e.target.files[0]; 
  if (!file) return;

  karaokeSelectedTrackBlob = file; 
  karaokeSelectedTrackName = file.name;

  const track = $("karaokeTrack"); 
  if (track) { 
    track.src = URL.createObjectURL(file); 
    track.volume = 0.4; 
  }
  const status = $("karaokeStatus");
  if (status) status.textContent = "Estado: Pista lista. ¡Presiona Iniciar Grabación!";
  cargarLetrasEnMonitor();
}

export async function loadTrackOptionsInKaraoke() {
  const select = $("karaokeTrackSelect"); 
  if (!select) return;
  select.innerHTML = '<option value="">Selecciona una pista desde tu Biblioteca</option>';
  try {
    const pistas = await getLibraryItemsByType("pista");
    if (!pistas.length) { 
      select.innerHTML = '<option value="">No hay pistas guardadas</option>'; 
      return; 
    }
    pistas.forEach(item => { 
      const o = document.createElement("option"); 
      o.value = item.id; 
      o.textContent = item.name; 
      select.appendChild(o); 
    });
  } catch (error) { 
    console.error(error); 
  }
}
export async function loadSelectedTrackFromLibraryKaraoke() {
  const select = $("karaokeTrackSelect"); 
  if (!select) return; 
  const id = Number(select.value);
  if (!id) { alert("⚠️ Selecciona una pista de la lista."); return; }
  try {
    const item = await getLibraryItemById(id); 
    if (!item) return;
    karaokeSelectedTrackBlob = item.audioBlob; 
    karaokeSelectedTrackName = item.name;
    const track = $("karaokeTrack"); 
    if (track) { 
      track.src = URL.createObjectURL(item.audioBlob); 
      track.volume = 0.4; 
    }
    const status = $("karaokeStatus");
    if (status) status.textContent = `Estado: Pista cargada (${item.name}). ¡Inicia grabación!`;
    cargarLetrasEnMonitor();
  } catch (error) { 
    console.error(error); 
  }
}

export function cargarLetrasEnMonitor() {
  const container = $("karaokeLiveLyrics"); 
  if (!container) return;
  let letrasACantar = window.transcriptionSegments || []; 
  container.innerHTML = "";
  if (!Array.isArray(letrasACantar) || letrasACantar.length === 0) { 
    container.innerHTML = '<p class="karaoke-placeholder" style="font-size:18px;">⚠️ Ve a la pestaña \'Estudio\', transcribe una voz y vuelve aquí para ver la letra.</p>'; 
    return; 
  }
  letrasACantar.forEach((seg, index) => {
    const p = document.createElement("p"); 
    p.className = "karaoke-live-line upcoming"; 
    p.id = `k-live-line-${index}`;
    p.dataset.start = Number(seg.start || 0); 
    p.dataset.end = Number(seg.end || 0);
    const words = Array.isArray(seg.words) ? seg.words : [];
    if (words.length) {
      words.forEach((wObj, wIdx) => {
        const span = document.createElement("span"); 
        span.className = "karaoke-live-word"; 
        span.dataset.start = Number(wObj.start || 0); 
        span.dataset.end = Number(wObj.end || 0);
        span.textContent = (wObj.word || "") + (wIdx < words.length - 1 ? " " : ""); 
        p.appendChild(span);
      });
    } else p.textContent = (seg.text || "").trim();
    container.appendChild(p);
  });
}

export function updateKaraokeLiveHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line"); 
  if (!lines.length) return;
  let nActiveLine = null, nActiveIdx = -1;
  for (let i = 0; i < lines.length; i++) { 
    if (currentTime >= parseFloat(lines[i].dataset.start) && currentTime <= parseFloat(lines[i].dataset.end)) { 
      nActiveLine = lines[i]; 
      nActiveIdx = i; 
      break; 
    } 
  }
  if (nActiveIdx !== lineaLiveActivaIndexCache) {
    lineaLiveActivaIndexCache = nActiveIdx;
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nActiveIdx) line.classList.add("active");
      else if (currentTime > parseFloat(line.dataset.end)) line.classList.add("past");
      else line.classList.add("upcoming");
    });
    if (nActiveLine && (window.autoScrollEnabled !== false)) nActiveLine.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (nActiveLine) {
    nActiveLine.querySelectorAll(".karaoke-live-word").forEach(w => {
      w.classList.remove("active-word", "past-word");
      if (currentTime >= parseFloat(w.dataset.start) && currentTime <= parseFloat(w.dataset.end)) w.classList.add("active-word");
      else if (currentTime > parseFloat(w.dataset.end)) w.classList.add("past-word");
    });
  }
}

export function syncKaraokeMonitor(currentTime) { 
  updateKaraokeLiveHighlight(currentTime); 
}

export async function startKaraokeRecording() {
  const track = $("karaokeTrack"); 
  if (!track || !track.src) { alert("⚠️ Primero sube una pista instrumental."); return; }
  try {
    const micCount = $("micCount"), isDuo = micCount && micCount.value === "2";
    if (window.karaokeStream?.getTracks) window.karaokeStream.getTracks().forEach(t => t.stop());
    if (window.karaokeStream2?.getTracks) window.karaokeStream2.getTracks().forEach(t => t.stop());
    karaokeChunks = []; 
    karaokeRecordedBlob = null; 
    karaokeDuoAnalyser1 = null; 
    karaokeDuoAnalyser2 = null;
    if ($("karaokeVoicePlayer")) $("karaokeVoicePlayer").src = "";
    karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const dest = karaokeDuoAudioContext.createMediaStreamDestination();
    const mic1Id = document.getElementById("mic1Select")?.value, mic2Id = document.getElementById("mic2Select")?.value;
    const stream1 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic1Id ? { exact: mic1Id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
    window.karaokeStream = stream1;
    
    const source1 = karaokeDuoAudioContext.createMediaStreamSource(stream1);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source1);
    const volNode1 = karaokeDuoAudioContext.createGain();
    const sliderVol1 = $("mic1Volume"); 
    volNode1.gain.value = sliderVol1 ? parseFloat(sliderVol1.value) : 1.0;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; 
    karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
    karaokeDuoAnalyser1.fftSize = 2048;
    volNode1.connect(karaokeDuoAnalyser1);
    const merger = karaokeDuoAudioContext.createChannelMerger(2);
    karaokeDuoAnalyser1.connect(merger, 0, 0);
    if (!isDuo) {
      karaokeDuoAnalyser1.connect(merger, 0, 1);
    }
    if (isDuo && mic2Id) {
      const stream2 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic2Id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 } });
      window.karaokeStream2 = stream2;
      const source2 = karaokeDuoAudioContext.createMediaStreamSource(stream2);
      const mic2Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source2);
      const volNode2 = karaokeDuoAudioContext.createGain();
      const sliderVol2 = $("mic2Volume");
      volNode2.gain.value = sliderVol2 ? parseFloat(sliderVol2.value) : 1.0;
      mic2Filtrado.connect(volNode2);
      currentVolNode2 = volNode2; 
      karaokeDuoAnalyser2 = karaokeDuoAudioContext.createAnalyser();
      karaokeDuoAnalyser2.fftSize = 2048;
      volNode2.connect(karaokeDuoAnalyser2);
      karaokeDuoAnalyser2.connect(merger, 0, 1);
      if ($("karaokeDuoIndicator")) $("karaokeDuoIndicator").style.display = "block";
    }
    merger.connect(dest);
    let finalStream = dest.stream;
    startKaraokeDuoLevelMonitor();
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    karaokeMediaRecorder = new MediaRecorder(finalStream, options);
    karaokeMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) karaokeChunks.push(e.data); };
    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      if ($("karaokeVoicePlayer")) $("karaokeVoicePlayer").src = URL.createObjectURL(karaokeRecordedBlob);
      if ($("karaokeStatus")) $("karaokeStatus").textContent = "Estado: Grabación finalizada ✅";
      stopKaraokeDuoLevelMonitor();
    };
    karaokeMediaRecorder.start();
    track.currentTime = 0;
    track.play();
    setTimeout(() => {
        let isRunning = window.isPitchDetectionRunning || false;
        if (!isRunning) {
            window.isPitchDetectionRunning = true;
            startKaraokePitchDetection();
        }
    }, 300);
    const status = $("karaokeStatus");
    if (status) {
      const mic1Select = $("mic1Select");
      const mic1Name = mic1Select ? mic1Select.options[mic1Select.selectedIndex]?.text : "Predeterminado";
      if (isDuo && mic2Id) {
        const mic2Select = $("mic2Select");
        const mic2Name = mic2Select ? mic2Select.options[mic2Select.selectedIndex]?.text : "Mic 2";
        status.textContent = `Estado: 🔴 Grabando DÚO (${mic1Name} + ${mic2Name})...`;
      } else {
        status.textContent = `Estado: 🔴 Grabando con ${mic1Name}...`;
      }
    }
    if ($("karaokeStartBtn")) $("karaokeStartBtn").disabled = true;
  } catch (err) {
    console.error("Error crítico al inicializar la grabación del Karaoke:", err);
    alert("❌ Error al acceder al micrófono de grabación.");
  }
}

export function startKaraokeDuoLevelMonitor() {
  const level1 = $("karaokeDuoMic1Level"), level2 = $("karaokeDuoMic2Level");
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

export function stopKaraokeDuoLevelMonitor() {
  if (karaokeDuoAnimationId) { cancelAnimationFrame(karaokeDuoAnimationId); karaokeDuoAnimationId = null; }
  const level1 = $("karaokeDuoMic1Level"), level2 = $("karaokeDuoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

export function stopKaraokeRecording() {
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    karaokeMediaRecorder.stop();
  }

  if (window.karaokeStream?.getTracks) {
    window.karaokeStream.getTracks().forEach(t => t.stop());
  }
  if (window.karaokeStream2?.getTracks) { 
    window.karaokeStream2.getTracks().forEach(t => t.stop()); 
    window.karaokeStream2 = null; 
  }

  if (karaokeDuoAudioContext) {
    karaokeDuoAudioContext.close().catch(() => {});
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null; 
  karaokeDuoAnalyser2 = null; 
  window.isPitchDetectionRunning = false;

  stopKaraokeDuoLevelMonitor();

  if (document.getElementById("karaokeDuoIndicator")) {
    document.getElementById("karaokeDuoIndicator").style.display = "none";
  }
  if (document.getElementById("karaokeTrack")) {
    document.getElementById("karaokeTrack").pause();
  }
  if (document.getElementById("karaokeStartBtn")) {
    document.getElementById("karaokeStartBtn").disabled = false;
  }
}

/**
 * Resetea por completo los buffers locales para vaciar la toma actual y reintentar
 */
export function restartKaraokeRecording() {
  const track = document.getElementById("karaokeTrack"); 
  if (track) { 
    track.pause(); 
    track.currentTime = 0; 
  }
  
  lineaLiveActivaIndexCache = -1;

  if (document.getElementById("karaokeVoicePlayer")) {
    document.getElementById("karaokeVoicePlayer").src = "";
  }
  
  karaokeChunks = []; 
  karaokeRecordedBlob = null;

  if (document.getElementById("karaokeStatus")) {
    document.getElementById("karaokeStatus").textContent = "Estado: Esperando para grabar...";
  }
  if (document.getElementById("karaokeStartBtn")) {
    document.getElementById("karaokeStartBtn").disabled = false;
  }

  window.pitchHistoryMic1 = []; 
  window.pitchHistoryMic2 = [];
}

/**
 * Aplica el tema visual de karaoke guardado en las configuraciones
 */
export function applyKaraokeTheme() {
  const theme = localStorage.getItem("singIt_stage") || "theme-clasico";
  const monitor = document.getElementById("karaokeLiveLyrics");
  if (monitor) {
    const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];
    todosLosTemas.forEach(tema => monitor.classList.remove(tema));
    monitor.classList.add(theme);
  }
}

/**
 * Combina en paralelo el archivo instrumental con la voz grabada aplicando balance y ganancia analógica
 */
export async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) { 
    alert("⚠️ Faltan ingredientes: Carga una pista e intenta grabar tu voz."); 
    return; 
  }
  const trackFile = karaokeSelectedTrackBlob, btn = $("karaokeMixBtn"), resultDiv = $("karaokeMixResult");
  if (btn) { btn.textContent = "🎧 Mezclando audios... ⏳"; btn.disabled = true; }
  if (resultDiv) resultDiv.innerHTML = "<p style='color: var(--text-muted);'>Uniendo la pista y tu voice buffer...</p>";
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const trackArrayBuffer = await trackFile.arrayBuffer(), trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer);
    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer(), voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer);
    const duracionMaximaMuestras = Math.max(trackBuffer.length, voiceBuffer.length);
    const offlineCtx = new OfflineAudioContext(trackBuffer.numberOfChannels, duracionMaximaMuestras, trackBuffer.sampleRate);
    const trackGain = offlineCtx.createGain(); trackGain.gain.value = 0.4;
    const trackSource = offlineCtx.createBufferSource(); trackSource.buffer = trackBuffer;
    trackSource.connect(trackGain); trackGain.connect(offlineCtx.destination);
    const voiceGain = offlineCtx.createGain(); voiceGain.gain.value = 1.8;
    const voiceSource = offlineCtx.createBufferSource(); voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceGain); voiceGain.connect(offlineCtx.destination);
    trackSource.start(0); voiceSource.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    const finalWavBlob = exportStereoWav(renderedBuffer);
    const finalUrl = URL.createObjectURL(finalWavBlob);
    if (resultDiv) {
      resultDiv.innerHTML = `
        <h4 style="color: #22c55e;">✅ ¡Mezcla completada!</h4>
        <audio controls src="${finalUrl}" style="width: 100%; margin-bottom: 15px; border-radius: 8px;"></audio>
        <div style="display: flex; gap: 10px;">
          <a href="${finalUrl}" download="Mezcla_${trackFile.name || "Karaoke"}.wav" style="flex: 1;"><button type="button" style="width: 100%; background: #22c55e; color: black;">💾 Descargar</button></a>
          <button id="saveMixToLibBtn" type="button" style="flex: 1; background: #3b82f6; color: white;">📁 Guardar en Biblioteca</button>
        </div>
      `;
    }
    const saveBtn = document.getElementById("saveMixToLibBtn");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.textContent = "Guardando..."; saveBtn.disabled = true;
        await saveToLibrary(finalWavBlob, { name: `Mezcla - ${trackFile.name || "Canción"}`, type: "grabacion" });
        saveBtn.textContent = "✅ ¡Guardado!";
      };
    }
  } catch (err) {
    console.error(err);
    if (resultDiv) resultDiv.innerHTML = "<p style='color: #ef4444;'>❌ Error al mezclar flujos.</p>";
  } finally {
    if (btn) { btn.textContent = "🎧 Mezclar Pista + Voz"; btn.disabled = false; }
  }
}

/**
 * Renderiza dinámicamente las tarjetas de tus creaciones guardadas y tus karaokes listos para cantar
 */
export async function loadMyKaraokeSongs() {
  const container = $("myKaraokeList"); if (!container) return;
  try {
    const karaokeSongs = await getLibraryItemsByType("karaoke"), voces = await getLibraryItemsByType("voz");
    const vocesConSync = voces.filter(v => v.transcription && v.transcription.length > 0);
    const allSongs = [...karaokeSongs, ...vocesConSync];
    if (allSongs.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);"><p>No tienes canciones listas aún.</p></div>`;
      return;
    }
    container.innerHTML = "";
    allSongs.forEach(song => {
      const div = document.createElement("div"); div.className = "my-karaoke-item";
      const title = song.metadata?.title || song.name || "Sin título", artist = song.metadata?.artist || "";
      div.innerHTML = `
        <div class="my-karaoke-item-info"><p class="my-karaoke-item-title">${title}</p><p class="my-karaoke-item-artist">${artist || "Artista desconocido"}</p></div>
        <div class="my-karaoke-item-actions">
          <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #22c55e;">▶️ Cantar</button>
          <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 8px 10px;">🗑️</button>
        </div>
      `;
      container.appendChild(div);
    });
    container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const selectedId = Number(btn.dataset.id);
        const statusEl = document.getElementById("karaokeStatus");
        
        if (statusEl) statusEl.textContent = "Estado: ⏳ Leyendo audio y calculando notas musicales...";
        
        try {
          const item = await getLibraryItemById(selectedId);
          if (item) {
            const track = document.getElementById("karaokeTrack");
            const audioSourceBlob = item.audioBlob || item.audioData;

            // 1. EXTRAER SEGMENTOS BASE
            let segmentosAProcesar = item.transcription || [];

            // 2. INYECTOR POLIMÓRFICO: Si las notas vienen en 0 (planas), forzamos un análisis de pitch offline rápido
            const necesitaAnalizarPitch = segmentosAProcesar.some(seg => !seg.midi || seg.midi === 60 || seg.pitch === 0);
            
            if (necesitaAnalizarPitch && audioSourceBlob) {
              console.log("🎵 Detectadas notas planas. Despertando analizador armónico offline...");
              try {
                // Importamos de forma dinámica el analizador matemático encapsulado en la pestaña de Estudio
                const estudioModulo = await import('./estudio.js');
                if (typeof estudioModulo.analyzePitchForSegments === "function") {
                  segmentosAProcesar = await estudioModulo.analyzePitchForSegments(audioSourceBlob, segmentosAProcesar);
                }
              } catch (pitchErr) {
                console.warn("No se pudo procesar el pitch de forma cruzada, usando rejilla plana:", pitchErr);
              }
            }

            // 3. TRANSFERENCIA A LA MEMORIA COMPARTIDA DEL CANVAS
            window.transcriptionSegments = segmentosAProcesar;
            
            // 4. REFRESCO DE MONITORES VISUALES
            cargarLetrasEnMonitor();
            
            // 5. DISPARADOR MULTIMEDIA NATIVO
            if (track && audioSourceBlob) {
              track.src = URL.createObjectURL(audioSourceBlob);
              track.play()
                .then(() => startKaraokePitchDetection())
                .catch(() => console.warn("Autoplay bloqueado. Presiona iniciar de forma manual."));
            } else {
              startKaraokePitchDetection();
            }
            
            if (statusEl) statusEl.textContent = `Estado: 🎤 Cantando -> ${item.name} (¡Notas sincronizadas! 🎯)`;
            document.getElementById("karaokeCanvas")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (e) {
          console.error("Error cargando y analizando canción en el Karaoke:", e);
          if (statusEl) statusEl.textContent = "Estado: ❌ Error al inicializar el pentagrama";
        }
      });
    });
    container.querySelectorAll(".delete-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Eliminar canción de tu biblioteca?")) { 
          await deleteLibraryItemFromDB(Number(btn.dataset.id)); 
          await loadMyKaraokeSongs(); 
        }
      });
    });
  } catch (error) { 
    console.error(error); 
    container.innerHTML = `<p style="color: #ef4444;">Error al cargar tus canciones</p>`; 
  }
}

/**
 * Consulta de forma asíncrona el archivo descriptor central del catálogo remoto y lo inyecta en el DOM
 */
export async function loadKaraokeCatalog() {
  const container = $("catalogList"); if (!container) return;
  container.innerHTML = `<p style="color: var(--text-muted);">Cargando catálogo...</p>`;
  try {
    const response = await fetch("./karaoke-catalog/catalog.json");
    if (!response.ok) throw new Error("No se pudo descargar el catálogo");
    const catalog = await response.json();
    if (!catalog.songs || catalog.songs.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);"><p>📚 Catálogo vacío.</p></div>`;
      return;
    }
    container.innerHTML = "";
    catalog.songs.forEach(song => {
      const div = document.createElement("div"); div.className = "catalog-item";
      div.innerHTML = `
        <div class="catalog-item-info"><p class="catalog-item-title">🎵 ${song.title}</p><p class="catalog-item-artist">${song.artist}</p></div>
        <div class="catalog-item-actions"><button type="button" class="load-catalog-btn" data-folder="${song.folder}" data-title="${song.title}" data-artist="${song.artist}" style="background: #22c55e;">▶️ Cantar</button></div>
      `;
      container.appendChild(div);
    });
    container.querySelectorAll(".load-catalog-btn").forEach(btn => {
      btn.addEventListener("click", async () => { 
        await loadCatalogSong(btn.dataset.folder, btn.dataset.title, btn.dataset.artist); 
      });
    });
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);"><p>📚 No se pudo cargar el catálogo.</p></div>`;
  }
}
