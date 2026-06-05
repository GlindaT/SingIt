import { $ } from '../script.js';
import { getLibraryItemById, getLibraryItemsByType, addLibraryItem } from './biblioteca.js';

// --- ARREGLOS GLOBALES TEMPORALES DE CAPTURA DE AUDIO ---
let karaokeChunks = [];
let karaokeMediaRecorder = null;
let karaokeRecordedAudioBlob = null;

export class KaraokeCanvasRenderer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas con ID ${canvasId} no encontrado`);
    this.ctx = this.canvas.getContext('2d');
    
    this.options = { maxFrameRate: options.maxFrameRate || 30, cacheSize: options.cacheSize || 100, ...options };
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / this.options.maxFrameRate;
    this.noteYCache = new Map();
    
    this.pentagramTop = 40; 
    this.midiMin = 36;      
    this.midiMax = 84;      
    this.midiRange = this.midiMax - this.midiMin;
    this.lineX = 80;        

    if (!window.pitchHistoryMic1) window.pitchHistoryMic1 = [];
    if (!window.pitchHistoryMic2) window.pitchHistoryMic2 = [];
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

    const pentagramHeight = this.canvas.height - 140; 
    const normalized = (this.midiMax - m) / this.midiRange;
    const y = this.pentagramTop + normalized * pentagramHeight;

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
      config = { fondo: `hsl(${hue}, 40%, 12%)`, lineas: "rgba(255, 255, 255, 0.15)", etiquetas: "#ff007f", barraFutura: `hsl(${(hue + 180) % 360}, 50%, 25%)`, bordeFuturo: `hsl(${(hue + 180) % 360}, 70%, 50%)` };
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

    let freqMic1 = typeof currentFreq === 'number' ? currentFreq : -1;
    let freqMic2 = typeof currentFreq2 === 'number' ? currentFreq2 : -1;
    let segmentosLetras = transcriptionSegments;

    if (Array.isArray(currentFreq2) && !transcriptionSegments) {
      segmentosLetras = currentFreq2;
      freqMic2 = -1;
    }

    if (!window.pitchHistoryMic1) window.pitchHistoryMic1 = [];
    if (!window.pitchHistoryMic2) window.pitchHistoryMic2 = [];

    window.pitchHistoryMic1.push(freqMic1 > 0 ? freqMic1 : null);
    window.pitchHistoryMic2.push(freqMic2 > 0 ? freqMic2 : null);

    if (window.pitchHistoryMic1.length > 80) window.pitchHistoryMic1.shift();
    if (window.pitchHistoryMic2.length > 80) window.pitchHistoryMic2.shift();

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
    this.ctx.font = "bold 20px sans-serif"; this.ctx.textAlign = "right";
    const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
    noteLabels.forEach((label, i) => {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i + 6;
      this.ctx.fillText(label, 28, y);
    });

    if (Array.isArray(segmentosLetras) && segmentosLetras.length > 0) {
      const timeWindowStart = currentTime - 1;
      const timeWindowEnd = currentTime + 5;
      const pixelsPerSecond = (this.canvas.width - 50) / 6;

      this.ctx.strokeStyle = "#ef4444"; this.ctx.lineWidth = 2;
      this.ctx.beginPath(); this.ctx.moveTo(this.lineX, this.pentagramTop); this.ctx.lineTo(this.lineX, pentagramBottom); this.ctx.stroke();

      segmentosLetras.forEach((segment, segmentIdx) => {
        const words = Array.isArray(segment.words) ? segment.words : [];
        words.forEach((word, wordIdx) => {
          if (word.end < timeWindowStart || word.start > timeWindowEnd) return;
          
          const wordStartX = this.lineX + (word.start - currentTime) * pixelsPerSecond;
          const wordEndX = this.lineX + (word.end - currentTime) * pixelsPerSecond;
          const barWidth = Math.max(wordEndX - wordStartX, 35);
          
          let midi = word.midi || segment.midi || 60;
          if (midi === 60) {
            const factorOndulacion = Math.sin((segmentIdx * 2) + (wordIdx * 1.5));
            midi = 60 + Math.round(factorOndulacion * 4);
          }

          const barY = this.midiToY(midi);
          const barHeight = 20;
          
          const isActive = currentTime >= word.start && currentTime <= word.end;
          const isPast = currentTime > word.end;
          
          let isCorrect = false;
          if (isActive) {
            if (freqMic1 && freqMic1 > 0) {
              const userMidi1 = this.frequencyToMidi(freqMic1);
              if (Math.abs(userMidi1 - midi) <= 2) isCorrect = true; 
            }
            if (freqMic2 && freqMic2 > 0) {
              const userMidi2 = this.frequencyToMidi(freqMic2);
              if (Math.abs(userMidi2 - midi) <= 2) isCorrect = true;
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
          
          this.ctx.fillStyle = barColor;
          this.ctx.strokeStyle = borderColor;
          this.ctx.lineWidth = isActive ? 2 : 1;

          try {
            this.ctx.beginPath();
            this.ctx.roundRect(wordStartX, barY - barHeight/2, barWidth, barHeight, 6); 
            this.ctx.fill(); this.ctx.stroke();
          } catch (e) {
            this.ctx.fillRect(wordStartX, barY - barHeight/2, barWidth, barHeight);
            this.ctx.strokeRect(wordStartX, barY - barHeight/2, barWidth, barHeight);
          }
          
          this.ctx.fillStyle = textColor; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
          let displayWord = word.word || word.text || "";
          if (displayWord.length > 8) {
            this.ctx.font = isActive ? "bold 22px sans-serif" : "20px sans-serif";
          } else {
            this.ctx.font = isActive ? "bold 26px sans-serif" : "24px sans-serif";
          }
          this.ctx.fillText(displayWord, wordStartX + barWidth/2, barY);
        });
      });

      if (window.pitchHistoryMic1 && window.pitchHistoryMic1.length > 0) {
        this.ctx.beginPath(); this.ctx.strokeStyle = "rgba(250, 204, 21, 0.9)"; this.ctx.lineWidth = 5;
        let started1 = false;
        window.pitchHistoryMic1.forEach((freq, i) => {
          if (freq && freq > 0) {
            const y = this.midiToY(this.frequencyToMidi(freq));
            const x = this.lineX - (window.pitchHistoryMic1.length - i) * 3; 
            if (x >= 0) {
              if (!started1) { this.ctx.moveTo(x, y); started1 = true; } else { this.ctx.lineTo(x, y); }
            }
          } else { started1 = false; }
        });
        this.ctx.stroke();
      }

      if (freqMic1 && freqMic1 > 0) {
        const userY1 = this.midiToY(this.frequencyToMidi(freqMic1));
        this.ctx.beginPath(); this.ctx.fillStyle = "#facc15"; this.ctx.shadowBlur = 20; this.ctx.shadowColor = "#facc15";
        this.ctx.arc(this.lineX, userY1, 9, 0, Math.PI * 2); this.ctx.fill(); this.ctx.shadowBlur = 0;
      }

      if (window.pitchHistoryMic2 && window.pitchHistoryMic2.length > 0) {
        this.ctx.beginPath(); this.ctx.strokeStyle = "rgba(6, 182, 212, 0.9)"; this.ctx.lineWidth = 5;
        let started2 = false;
        window.pitchHistoryMic2.forEach((freq, i) => {
          if (freq && freq > 0) {
            const y = this.midiToY(this.frequencyToMidi(freq));
            const x = this.lineX - (window.pitchHistoryMic2.length - i) * 3; 
