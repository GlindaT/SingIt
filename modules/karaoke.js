// ==========================================
// OPTIMIZED KARAOKE CANVAS RENDERER
// ==========================================
// This module provides high-performance canvas rendering for the karaoke monitor
// Features:
// - Dirty rectangle invalidation (only redraw changed areas)
// - Throttled updates (configurable frame rate)
// - Cached computations
// - Memory-efficient buffer reuse

class KaraokeCanvasRenderer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas with ID ${canvasId} not found`);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Configuration
    this.options = {
      maxFrameRate: options.maxFrameRate || 30, // Cap at 30 FPS instead of 60
      enableDirtyRects: options.enableDirtyRects !== false,
      cacheSize: options.cacheSize || 100,
      ...options
    };
    
    // Frame throttling
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / this.options.maxFrameRate;
    
    // Cache for computed values
    this.cache = new Map();
    this.noteYCache = new Map();
    this.segmentBoundsCache = new Map();
    
    // Dirty rectangle tracking
    this.dirtyRects = [];
    this.lastState = null;
    
    // Shared buffer for audio data
    this.audioBuffer = new Float32Array(2048);
    
    // Config (computed once)
    this.pentagramTop = 30;
    this.pentagramBottom = this.canvas.height - 60;
    this.pentagramHeight = this.pentagramBottom - this.pentagramTop;
    this.midiMin = 48;
    this.midiMax = 84;
    this.midiRange = this.midiMax - this.midiMin;
    this.timeWindowStart = 0;
    this.timeWindowEnd = 0;
    this.pixelsPerSecond = (this.canvas.width - 40) / 6;
    this.lineX = 40;
    
    // Note labels (static)
    this.noteLabels = ["C6", "A5", "F5", "D5", "B4", "G4", "E4", "C4", "A3", "F3", "D3", "C3"];
    this.numLines = 12;
  }

  /**
   * Throttle frame updates to reduce unnecessary redraws
   */
  shouldRender() {
    const now = performance.now();
    if (now - this.lastFrameTime < this.frameInterval) {
      return false;
    }
    this.lastFrameTime = now;
    return true;
  }

  /**
   * Convert MIDI note to Y pixel position (cached)
   */
  midiToY(midi) {
    // Check cache first
    if (this.noteYCache.has(midi)) {
      return this.noteYCache.get(midi);
    }

    if (!midi || midi < this.midiMin) midi = this.midiMin;
    if (midi > this.midiMax) midi = this.midiMax;

    const normalized = (this.midiMax - midi) / this.midiRange;
    const y = this.pentagramTop + normalized * this.pentagramHeight;

    // Cache for future use (limit cache size)
    if (this.noteYCache.size > this.options.cacheSize) {
      const firstKey = this.noteYCache.keys().next().value;
      this.noteYCache.delete(firstKey);
    }
    this.noteYCache.set(midi, y);

    return y;
  }

  /**
   * Draw staff lines (only once or when resized)
   */
  drawStaff() {
    this.ctx.strokeStyle = "#333";
    this.ctx.lineWidth = 1;

    for (let i = 0; i <= this.numLines; i++) {
      const y = this.pentagramTop + (this.pentagramHeight / this.numLines) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    // Draw note labels
    this.ctx.fillStyle = "#666";
    this.ctx.font = "10px Arial";
    this.ctx.textAlign = "right";

    this.noteLabels.forEach((label, i) => {
      const y = this.pentagramTop + (this.pentagramHeight / this.numLines) * i + 4;
      this.ctx.fillText(label, 25, y);
    });
  }

  /**
   * Draw note bars with optimizations
   */
  drawNotes(transcriptionSegments, currentTime, currentFreq) {
    if (!Array.isArray(transcriptionSegments) || transcriptionSegments.length === 0) {
      return;
    }

    // Update time window
    this.timeWindowStart = currentTime - 1;
    this.timeWindowEnd = currentTime + 5;

    // Draw current time line
    this.ctx.strokeStyle = "#ef4444";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(this.lineX, this.pentagramTop);
    this.ctx.lineTo(this.lineX, this.pentagramBottom);
    this.ctx.stroke();

    // Process segments
    transcriptionSegments.forEach((segment) => {
      const words = Array.isArray(segment.words) ? segment.words : [];

      words.forEach((word) => {
        // Skip words outside visible window
        if (word.end < this.timeWindowStart || word.start > this.timeWindowEnd) {
          return;
        }

        // Calculate bar position and size
        const wordStartX = this.lineX + (word.start - currentTime) * this.pixelsPerSecond;
        const wordEndX = this.lineX + (word.end - currentTime) * this.pixelsPerSecond;
        const barWidth = Math.max(wordEndX - wordStartX, 20);

        // Get MIDI and position
        const midi = word.midi || segment.midi || 60;
        const barY = this.midiToY(midi);
        const barHeight = 22;

        // Determine state
        const isActive = currentTime >= word.start && currentTime <= word.end;
        const isPast = currentTime > word.end;

        // Check if pitch is correct
        let isCorrect = false;
        if (isActive && currentFreq > 0) {
          const userMidi = this.frequencyToMidi(currentFreq);
          isCorrect = Math.abs(userMidi - midi) <= 2;
        }

        // Determine colors
        const { barColor, textColor, borderColor } = this.getBarColors(isPast, isActive, isCorrect);

        // Draw bar with rounded corners
        this.ctx.fillStyle = barColor;
        this.ctx.beginPath();
        this.ctx.roundRect(wordStartX, barY - barHeight / 2, barWidth, barHeight, 8);
        this.ctx.fill();

        // Draw border
        this.ctx.strokeStyle = borderColor;
        this.ctx.lineWidth = isActive ? 2 : 1;
        this.ctx.stroke();

        // Draw text
        this.ctx.fillStyle = textColor;
        this.ctx.font = isActive ? "bold 12px Arial" : "11px Arial";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        let displayWord = (word.word || "").substring(0, 10);
        if (displayWord.length > 10) {
          displayWord = displayWord.substring(0, 8) + "..";
        }
        this.ctx.fillText(displayWord, wordStartX + barWidth / 2, barY);
      });
    });
  }
 getBarColors(isPast, isActive, isCorrect) {
    if (isPast) {
      return {
        barColor: "#4b5563",
        textColor: "#9ca3af",
        borderColor: "#6b7280"
      };
    } else if (isActive) {
      if (isCorrect) {
        return {
          barColor: "#22c55e",
          textColor: "#ffffff",
          borderColor: "#4ade80"
        };
      } else {
        return {
          barColor: "#3b82f6",
          textColor: "#ffffff",
          borderColor: "#60a5fa"
        };
      }
    } else {
      return {
        barColor: "#1e40af",
        textColor: "#93c5fd",
        borderColor: "#3b82f6"
      };
    }
  }

  /**
   * Draw user's voice trace (optimized with limited history)
   */
  drawVoiceTrace(pitchHistory, currentFreq) {
    if (currentFreq <= 0 || pitchHistory.length === 0) return;

    const userMidi = this.frequencyToMidi(currentFreq);
    const userY = this.midiToY(userMidi);

    // Draw current point with glow effect
    this.ctx.beginPath();
    this.ctx.fillStyle = "#facc15";
    this.ctx.shadowBlur = 15;
    this.ctx.shadowColor = "#facc15";
    this.ctx.arc(this.lineX, userY, 8, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // Draw trace (only last 30 points for performance)
    const maxTraceLength = Math.min(30, pitchHistory.length);
    const startIndex = pitchHistory.length - maxTraceLength;

    this.ctx.beginPath();
    this.ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
    this.ctx.lineWidth = 3;

    let started = false;
    for (let i = startIndex; i < pitchHistory.length; i++) {
      const freq = pitchHistory[i];
      if (!freq) continue;

      const midi = this.frequencyToMidi(freq);
      const y = this.midiToY(midi);
      const x = this.lineX - (pitchHistory.length - i) * 2;

      if (!started) {
        this.ctx.moveTo(x, y);
        started = true;
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();
  }

  /**
   * Draw current and next lyrics
   */
  drawLyrics(transcriptionSegments, currentTime) {
    const currentSegment = transcriptionSegments.find(seg =>
      currentTime >= seg.start && currentTime <= seg.end + 0.5
    );

    if (currentSegment) {
      // Background
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      this.ctx.fillRect(0, this.canvas.height - 50, this.canvas.width, 50);

      // Text
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "bold 20px Arial";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(currentSegment.text || "", this.canvas.width / 2, this.canvas.height - 25);
    } else {
      // Show next segment if no current
      const nextSegment = transcriptionSegments.find(seg => seg.start > currentTime);
      if (nextSegment) {
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        this.ctx.fillRect(0, this.canvas.height - 50, this.canvas.width, 50);

        this.ctx.fillStyle = "#94a3b8";
        this.ctx.font = "16px Arial";
        this.ctx.textAlign = "center";
        this.ctx.fillText("Próximo: " + (nextSegment.text || ""), this.canvas.width / 2, this.canvas.height - 25);
      }
    }
  }

  /**
   * Frequency to MIDI conversion
   */
  frequencyToMidi(freq) {
    if (freq <= 0) return 0;
    return Math.round(12 * Math.log2(freq / 440) + 69);
  }

  /**
   * Main render function with throttling and optimization
   */
  render(currentTime, currentFreq, transcriptionSegments, pitchHistory) {
    // Throttle frame rate
    if (!this.shouldRender()) {
      return;
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw static elements (staff and labels)
    this.drawStaff();

    // Draw notes
    if (transcriptionSegments && transcriptionSegments.length > 0) {
      this.drawNotes(transcriptionSegments, currentTime, currentFreq);
    } else {
      // Placeholder message
      this.ctx.fillStyle = "#666";
      this.ctx.font = "16px Arial";
      this.ctx.textAlign = "center";
      this.ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas", this.canvas.width / 2, this.canvas.height / 2);
    }

    // Draw voice trace
    if (pitchHistory && pitchHistory.length > 0) {
      this.drawVoiceTrace(pitchHistory, currentFreq);
    }

    // Draw lyrics
    if (transcriptionSegments && transcriptionSegments.length > 0) {
      this.drawLyrics(transcriptionSegments, currentTime);
    }
  }

  /**
   * Clear all caches (call on memory pressure or tab change)
   */
  clearCaches() {
    this.noteYCache.clear();
    this.segmentBoundsCache.clear();
    this.cache.clear();
  }

  /**
   * Handle window resize
   */
  handleResize() {
    this.pentagramBottom = this.canvas.height - 60;
    this.pentagramHeight = this.pentagramBottom - this.pentagramTop;
    this.pixelsPerSecond = (this.canvas.width - 40) / 6;
    this.clearCaches();
  }
}

// ==========================================
// USAGE IN MAIN SCRIPT
// ==========================================
// Add this at the top of script.js after the global config:

// Initialize renderer (once)
let karaokeRenderer = null;

function initKaraokeRenderer() {
  if (!karaokeRenderer) {
    karaokeRenderer = new KaraokeCanvasRenderer('karaokeCanvas', {
      maxFrameRate: 30, // Limit to 30 FPS for better performance
      enableDirtyRects: true,
      cacheSize: 100
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (karaokeRenderer) {
        karaokeRenderer.handleResize();
      }
    });
  }
  return karaokeRenderer;
}

// Replace the original drawKaraokeMonitor function with:
function drawKaraokeMonitor(currentTime, currentFreq) {
  const renderer = initKaraokeRenderer();
  if (!renderer) return;

  renderer.render(
    currentTime,
    currentFreq,
    transcriptionSegments,
    pitchHistory
  );
}

// Also export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KaraokeCanvasRenderer;
}
import { $ } from '../script.js';

/**
 * Genera dinámicamente las etiquetas HTML en el DOM del karaoke con marcas de tiempo asíncronas
 */
export function renderKaraokeLyrics(segments) {
  const container = $("karaokeLyrics");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(segments) || !segments.length) {
    container.innerHTML = `<p class="karaoke-placeholder">No hay segmentos para mostrar.</p>`;
    return;
  }

  segments.forEach((segment, index) => {
    const line = document.createElement("p");
    line.className = "karaoke-line upcoming"; 
    line.id = `k-line-${index}`; 
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
}
let lineaActivaIndexCache = -1;

/**
 * Modifica las clases CSS de las palabras y líneas del karaoke basándose en el tiempo actual del reproductor
 */
export function updateKaraokeHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-line");
  if (!lines.length) return;

  let nuevoActiveLine = null;
  let nuevoActiveIndex = -1;

  // 1. Encontrar la línea activa basándonos en marcas de tiempo aproximadas
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    if (currentTime >= start && currentTime <= end) {
      nuevoActiveLine = line;
      nuevoActiveIndex = i;
      break;
    }
  }

  // 2. Solo mutamos las clases globales del DOM si la línea activa realmente cambió
  if (nuevoActiveIndex !== lineaActivaIndexCache) {
    lineaActivaIndexCache = nuevoActiveIndex;
    
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nuevoActiveIndex) {
        line.classList.add("active");
      } else if (currentTime > parseFloat(line.dataset.end)) {
        line.classList.add("past");
      } else {
        line.classList.add("upcoming");
      }
    });

    // Verificación segura del autoScrollEnabled almacenado en la pestaña de Estudio
    let autoScroll = true; // Por defecto activo
    if (window.autoScrollEnabled !== undefined) {
      autoScroll = window.autoScrollEnabled;
    }

    if (nuevoActiveLine && autoScroll) {
      nuevoActiveLine.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }

  // 3. Procesar las palabras internas únicamente sobre la línea activa actual (Máximo Rendimiento)
  if (nuevoActiveLine) {
    const words = nuevoActiveLine.querySelectorAll(".karaoke-word");
    words.forEach((word) => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  }
}
import { $ } from '../script.js';
import { getLibraryItemsByType, getLibraryItemById } from './biblioteca.js'; // Conexión modular con la BD

// Variables de estado del Karaoke encapsuladas de forma segura dentro de este módulo
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

/**
 * Carga un archivo binario de audio local directo al reproductor del Karaoke
 */
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
  
  if (typeof cargarLetrasEnMonitor === "function") {
    cargarLetrasEnMonitor();
  }
}

/**
 * Lee la base de datos y llena el selector del Karaoke con las pistas de música disponibles
 */
export async function loadTrackOptionsInKaraoke() {
  const select = $("karaokeTrackSelect");
  if (!select) return;

  select.innerHTML = `<option value="">Selecciona una pista desde tu Biblioteca</option>`;

  try {
    // LLAMADA MODULAR: Extrae de la BD únicamente los archivos marcados de tipo "pista"
    const pistas = await getLibraryItemsByType("pista");

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
    console.error("Error al cargar opciones de pistas en Karaoke:", error);
  }
}

/**
 * Descarga de la BD la pista elegida por el usuario y la inyecta en el reproductor del Karaoke
 */
export async function loadSelectedTrackFromLibraryKaraoke() {
  const select = $("karaokeTrackSelect");
  if (!select) return;
  
  const id = Number(select.value);

  if (!id) {
    alert("⚠️ Selecciona una pista de la lista.");
    return;
  }

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
    
    if (typeof cargarLetrasEnMonitor === "function") {
      cargarLetrasEnMonitor();
    }
  } catch (error) {
    console.error("Error al cargar pista seleccionada de biblioteca en Karaoke:", error);
    alert("❌ Error al cargar la pista.");
  }
}
export function cargarLetrasEnMonitor() {
  const container = $("karaokeLiveLyrics");
  if (!container) return;

  // Corregido: Variable 100% limpia en español sin caracteres extraños
  let letrasACantar = window.transcriptionSegments || [];

  container.innerHTML = "";

  if (!Array.isArray(letrasACantar) || letrasACantar.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size:18px;">⚠️ Ve a la pestaña 'Estudio', transcribe una voz y vuelve aquí para ver la letra.</p>`;
    return;
  }

  // Corregido el bucle con la variable limpia
  letrasACantar.forEach((seg, index) => {
    const p = document.createElement("p");
    p.className = "karaoke-live-line upcoming"; 
    p.id = `k-live-line-${index}`; 
    p.dataset.index = index;
    p.dataset.start = Number(seg.start || 0);
    p.dataset.end = Number(seg.end || 0);

    const words = Array.isArray(seg.words) ? seg.words : [];

    if (words.length) {
      words.forEach((wordObj, wordIndex) => {
        const span = document.createElement("span");
        span.className = "karaoke-live-word";
        span.dataset.start = Number(wordObj.start || 0);
        span.dataset.end = Number(wordObj.end || 0);
        span.textContent = (wordObj.word || "") + (wordIndex < words.length - 1 ? " " : "");
        p.appendChild(span);
      });
    } else {
      p.textContent = (seg.text || "").trim();
    }

    container.appendChild(p);
  });
}
export function updateKaraokeLiveHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) return;

  let nuevoActiveLine = null;
  let nuevoActiveIndex = -1;

  // 1. Localizar la línea actual en tiempo de ejecución
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    if (currentTime >= start && currentTime <= end) {
      nuevoActiveLine = line;
      nuevoActiveIndex = i;
      break;
    }
  }

  // 2. Mudar clases globales únicamente si hay un cambio de renglón real
  if (nuevoActiveIndex !== lineaLiveActivaIndexCache) {
    lineaLiveActivaIndexCache = nuevoActiveIndex;
    
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nuevoActiveIndex) {
        line.classList.add("active");
      } else if (currentTime > parseFloat(line.dataset.end)) {
        line.classList.add("past");
      } else {
        line.classList.add("upcoming");
      }
    });

    // Control seguro del autoScroll compartido
    let autoScroll = true;
    if (window.autoScrollEnabled !== undefined) {
      autoScroll = window.autoScrollEnabled;
    }

    if (nuevoActiveLine && autoScroll) {
      nuevoActiveLine.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }

  // 3. Resaltar sílabas individuales dentro de la línea activa (Máximo Rendimiento)
  if (nuevoActiveLine) {
    const words = nuevoActiveLine.querySelectorAll(".karaoke-live-word");
    words.forEach((word) => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  }
}
export function cargarLetrasEnMonitor() {
  const container = $("karaokeLiveLyrics");
  if (!container) return;

  // Corregido: Variable 100% limpia en español sin caracteres extraños
  let letrasACantar = window.transcriptionSegments || [];

  container.innerHTML = "";

  if (!Array.isArray(letrasACantar) || letrasACantar.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size:18px;">⚠️ Ve a la pestaña 'Estudio', transcribe una voz y vuelve aquí para ver la letra.</p>`;
    return;
  }

  // Corregido el bucle con la variable limpia
  letrasACantar.forEach((seg, index) => {
    const p = document.createElement("p");
    p.className = "karaoke-live-line upcoming"; 
    p.id = `k-live-line-${index}`; 
    p.dataset.index = index;
    p.dataset.start = Number(seg.start || 0);
    p.dataset.end = Number(seg.end || 0);

    const words = Array.isArray(seg.words) ? seg.words : [];

    if (words.length) {
      words.forEach((wordObj, wordIndex) => {
        const span = document.createElement("span");
        span.className = "karaoke-live-word";
        span.dataset.start = Number(wordObj.start || 0);
        span.dataset.end = Number(wordObj.end || 0);
        span.textContent = (wordObj.word || "") + (wordIndex < words.length - 1 ? " " : "");
        p.appendChild(span);
      });
    } else {
      p.textContent = (seg.text || "").trim();
    }

    container.appendChild(p);
  });
}
export function updateKaraokeLiveHighlight(currentTime) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length) return;

  let nuevoActiveLine = null;
  let nuevoActiveIndex = -1;

  // 1. Localizar la línea actual en tiempo de ejecución
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = parseFloat(line.dataset.start);
    const end = parseFloat(line.dataset.end);

    if (currentTime >= start && currentTime <= end) {
      nuevoActiveLine = line;
      nuevoActiveIndex = i;
      break;
    }
  }

  // 2. Mudar clases globales únicamente si hay un cambio de renglón real
  if (nuevoActiveIndex !== lineaLiveActivaIndexCache) {
    lineaLiveActivaIndexCache = nuevoActiveIndex;
    
    lines.forEach((line, i) => {
      line.classList.remove("active", "past", "upcoming");
      if (i === nuevoActiveIndex) {
        line.classList.add("active");
      } else if (currentTime > parseFloat(line.dataset.end)) {
        line.classList.add("past");
      } else {
        line.classList.add("upcoming");
      }
    });

    // Control seguro del autoScroll compartido
    let autoScroll = true;
    if (window.autoScrollEnabled !== undefined) {
      autoScroll = window.autoScrollEnabled;
    }

    if (nuevoActiveLine && autoScroll) {
      nuevoActiveLine.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }

  // 3. Resaltar sílabas individuales dentro de la línea activa (Máximo Rendimiento)
  if (nuevoActiveLine) {
    const words = nuevoActiveLine.querySelectorAll(".karaoke-live-word");
    words.forEach((word) => {
      const wordStart = parseFloat(word.dataset.start);
      const wordEnd = parseFloat(word.dataset.end);

      word.classList.remove("active-word", "past-word");

      if (currentTime >= wordStart && currentTime <= wordEnd) {
        word.classList.add("active-word");
      } else if (currentTime > wordEnd) {
        word.classList.add("past-word");
      }
    });
  }
}
import { $ } from '../script.js';
import { aplicarCadenaDeAudioKaraoke } from './estudio.js'; // Importación modular cruzada de efectos vocales

// Asegúrate de que las variables de control del módulo declaradas al inicio de este archivo incluyan estas referencias:
let karaokeMediaRecorder = null;
let karaokeStream = null;
let karaokeStream2 = null;
let karaokeChunks = [];
let karaokeRecordedBlob = null;
let karaokeDuoAudioContext = null;
let karaokeDuoAnalyser1 = null;
let karaokeDuoAnalyser2 = null;
let currentVolNode1 = null;
let currentVolNode2 = null;

// Función de utilidad local para mapear los micrófonos de la configuración
function getSelectedMicId(micNumber) {
  const select = document.getElementById(`mic${micNumber}Select`);
  return select ? select.value : null;
}

/**
 * Activa de forma automatizada la pista de música instrumental y graba la voz procesada en estéreo/dúo
 */
export async function startKaraokeRecording() {
  const track = $("karaokeTrack");
  if (!track || !track.src) { alert("⚠️ Primero sube una pista instrumental."); return; }

  try {
    const micCount = $("micCount");
    const isDuo = micCount && micCount.value === "2";

    // 1. LIMPIEZA ABSOLUTA DE HARDWARE ANTES DE EMPEZAR
    if (window.karaokeStream && typeof window.karaokeStream.getTracks === 'function') {
        window.karaokeStream.getTracks().forEach(t => t.stop());
    }
    if (window.karaokeStream2 && typeof window.karaokeStream2.getTracks === 'function') {
        window.karaokeStream2.getTracks().forEach(t => t.stop());
    }

    karaokeChunks = [];
    karaokeRecordedBlob = null;
    karaokeDuoAnalyser1 = null; 
    karaokeDuoAnalyser2 = null; 
    
    const voicePlayer = $("karaokeVoicePlayer");
    if (voicePlayer) voicePlayer.src = "";

    karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = karaokeDuoAudioContext.createMediaStreamDestination();

    const mic1Id = getSelectedMicId(1);
    const mic2Id = getSelectedMicId(2);

    const audioConstraints1 = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000
    };
    if (mic1Id) audioConstraints1.deviceId = { exact: mic1Id };

    const stream1 = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints1 });
    window.karaokeStream = stream1; 

    // Procesar Mic 1 utilizando la cadena de efectos compartida de Estudio
    const source1 = karaokeDuoAudioContext.createMediaStreamSource(stream1);
    const mic1Filtrado = aplicarCadenaDeAudioKaraoke(karaokeDuoAudioContext, source1);

    // Control de volumen dinámico Mic 1
    const volNode1 = karaokeDuoAudioContext.createGain();
    const sliderVol1 = $("mic1Volume"); 
    volNode1.gain.value = sliderVol1 ? parseFloat(sliderVol1.value) : 1.0;
    mic1Filtrado.connect(volNode1);
    currentVolNode1 = volNode1; 

    // Conexión en serie optimizada
    karaokeDuoAnalyser1 = karaokeDuoAudioContext.createAnalyser();
    karaokeDuoAnalyser1.fftSize = 2048;
    volNode1.connect(karaokeDuoAnalyser1);

    const merger = karaokeDuoAudioContext.createChannelMerger(2);
    karaokeDuoAnalyser1.connect(merger, 0, 0);

    if (!isDuo) {
      karaokeDuoAnalyser1.connect(merger, 0, 1);
    }

    // Configuración opcional para grabación en DÚO (Micrófono 2)
    if (isDuo && mic2Id) {
      const audioConstraints2 = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000,
        deviceId: { exact: mic2Id }
      };

      const stream2 = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints2 });
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

      const duoIndicator = $("karaokeDuoIndicator");
      if (duoIndicator) duoIndicator.style.display = "block";
    }

    merger.connect(destination);
    let finalStream = destination.stream;

    // Validación segura de la función del monitor visual de volumen
    if (typeof startKaraokeDuoLevelMonitor === 'function') {
      startKaraokeDuoLevelMonitor();
    }

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    karaokeMediaRecorder = new MediaRecorder(finalStream, options);

    karaokeMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) karaokeChunks.push(e.data);
    };

    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      const kvp = $("karaokeVoicePlayer");
      if (kvp) kvp.src = URL.createObjectURL(karaokeRecordedBlob);
      
      const status = $("karaokeStatus");
      if (status) status.textContent = "Estado: Grabación finalizada ✅";
      
      if (typeof stopKaraokeDuoLevelMonitor === 'function') {
        stopKaraokeDuoLevelMonitor();
      }
    };

    karaokeMediaRecorder.start();
    track.currentTime = 0;
    track.play();

    // Activación controlada del hilo asíncrono del detector de notas del afinador en vivo
    setTimeout(() => {
        let isRunning = window.isPitchDetectionRunning || false;
        if (!isRunning) {
            window.isPitchDetectionRunning = true;
            if (typeof startKaraokePitchDetection === 'function') {
              startKaraokePitchDetection();
            }
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
    
    const startBtn = $("karaokeStartBtn");
    if (startBtn) startBtn.disabled = true;

  } catch (err) {
    console.error("Error crítico al inicializar la grabación del Karaoke:", err);
    alert("❌ Error al acceder al micrófono de grabación.");
  }
}
import { $ } from '../script.js';
import { saveToLibrary } from './biblioteca.js'; // Conexión modular segura para guardar la mezcla
import { updateKaraokeLiveHighlight } from './karaoke.js'; // Referencia local interna

// Asegúrate de que las variables declaradas arriba en tu archivo compartan el alcance de este bloque:
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
let lineaLiveActivaIndexCache = -1;

/**
 * UTILERÍA LOCAL: Convierte un AudioBuffer multicanal renderizado en un archivo binario WAV estándar
 */
function exportStereoWav(audioBuffer) {
  const numOfChan = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM Lineal
  const bitDepth = 16;
  
  let result;
  if (numOfChan === 2) {
    result = interleave(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1));
  } else {
    result = audioBuffer.getChannelData(0);
  }
  
  const buffer = new ArrayBuffer(44 + result.length * 2);
  const view = new DataView(buffer);
  
  // Cabecera RIFF/WAVE
  const writeString = (viewObj, offset, string) => {
    for (let i = 0; i < string.length; i++) viewObj.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + result.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, result.length * 2, true);
  
  // Escribir muestras binarias PCM
  let offset = 44;
  for (let i = 0; i < result.length; i++) {
    let sample = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

/**
 * Monitor visual de volumen de los micrófonos en la pestaña de Karaoke
 */
export function startKaraokeDuoLevelMonitor() {
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

/**
 * Detiene el hilo de fotogramas del monitor de volumen de la barra del karaoke
 */
export function stopKaraokeDuoLevelMonitor() {
  if (karaokeDuoAnimationId) {
    cancelAnimationFrame(karaokeDuoAnimationId);
    karaokeDuoAnimationId = null;
  }
  const level1 = $("karaokeDuoMic1Level");
  const level2 = $("karaokeDuoMic2Level");
  if (level1) level1.style.width = "0%";
  if (level2) level2.style.width = "0%";
}

/**
 * Detiene la grabación del karaoke liberando los descriptores de hardware del micrófono
 */
export function stopKaraokeRecording() {
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") {
    karaokeMediaRecorder.stop();
  }

  if (window.karaokeStream) {
    window.karaokeStream.getTracks().forEach(t => t.stop());
  }
  if (window.karaokeStream2) {
    window.karaokeStream2.getTracks().forEach(t => t.stop());
    window.karaokeStream2 = null;
  }

  if (karaokeDuoAudioContext) {
    karaokeDuoAudioContext.close();
    karaokeDuoAudioContext = null;
  }

  karaokeDuoAnalyser1 = null;
  karaokeDuoAnalyser2 = null;
  window.isPitchDetectionRunning = false; 

  stopKaraokeDuoLevelMonitor();

  const duoIndicator = $("karaokeDuoIndicator");
  if (duoIndicator) duoIndicator.style.display = "none";

  const track = $("karaokeTrack");
  if (track) track.pause();

  const startBtn = $("karaokeStartBtn");
  if (startBtn) startBtn.disabled = false;
}

/**
 * Resetea por completo los buffers locales para vaciar la toma actual y reintentar
 */
export function restartKaraokeRecording() {
  const track = $("karaokeTrack");
  if (track) {
    track.pause();
    track.currentTime = 0;
  }

  lineaLiveActivaIndexCache = -1;

  const kvp = $("karaokeVoicePlayer");
  if (kvp) kvp.src = "";
  
  karaokeChunks = [];
  karaokeRecordedBlob = null;
  
  const status = $("karaokeStatus");
  if (status) status.textContent = "Estado: Esperando para grabar...";
  
  const startBtn = $("karaokeStartBtn");
  if (startBtn) startBtn.disabled = false;
  
  window.pitchHistoryMic1 = [];
  window.pitchHistoryMic2 = [];
}

/**
 * Enlaza directamente el actualizador de reproducción multimedia con la interfaz visual
 */
export function syncKaraokeMonitor(currentTime) {
  updateKaraokeLiveHighlight(currentTime);
}

/**
 * Combina en paralelo el archivo instrumental con la voz grabada aplicando balance y ganancia analógica
 */
export async function mixKaraoke() {
  if (!karaokeSelectedTrackBlob || !karaokeRecordedBlob) {
    alert("⚠️ Faltan ingredientes: Asegúrate de cargar una pista instrumental y grabar tu voz primero.");
    return;
  }

  const trackFile = karaokeSelectedTrackBlob;
  const btn = $("karaokeMixBtn");
  const resultDiv = $("karaokeMixResult");

  if (btn) { btn.textContent = "🎧 Mezclando audios... ⏳"; btn.disabled = true; }
  if (resultDiv) resultDiv.innerHTML = "<p style='color: var(--text-muted);'>Uniendo la pista y tu voz. Esto puede tardar unos segundos...</p>";

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const trackArrayBuffer = await trackFile.arrayBuffer();
    const trackBuffer = await audioCtx.decodeAudioData(trackArrayBuffer);

    const voiceArrayBuffer = await karaokeRecordedBlob.arrayBuffer();
    const voiceBuffer = await audioCtx.decodeAudioData(voiceArrayBuffer);

    const duracionMaximaMuestras = Math.max(trackBuffer.length, voiceBuffer.length);

    const offlineCtx = new OfflineAudioContext(
      trackBuffer.numberOfChannels,
      duracionMaximaMuestras,
      trackBuffer.sampleRate
    );

    const trackGain = offlineCtx.createGain();
    trackGain.gain.value = 0.4; 

    const trackSource = offlineCtx.createBufferSource();
    trackSource.buffer = trackBuffer;
    trackSource.connect(trackGain);
    trackGain.connect(offlineCtx.destination);

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.value = 1.8; 

    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    trackSource.start(0);
    voiceSource.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const finalWavBlob = exportStereoWav(renderedBuffer);
    const finalUrl = URL.createObjectURL(finalWavBlob);

    if (resultDiv) {
      resultDiv.innerHTML = `
        <h4 style="color: #22c55e;">✅ ¡Mezcla completada!</h4>
        <audio controls src="${finalUrl}" style="width: 100%; margin-bottom: 15px; border-radius: 8px;"></audio>
        <div style="display: flex; gap: 10px;">
          <a href="${finalUrl}" download="Mezcla_${trackFile.name || "Karaoke"}.wav" style="flex: 1;">
            <button type="button" style="width: 100%; background: #22c55e; color: black;">💾 Descargar Archivo</button>
          </a>
          <button id="saveMixToLibBtn" type="button" style="flex: 1; background: #3b82f6; color: white;">📁 Guardar en Biblioteca</button>
        </div>
      `;
    }

    const saveBtn = $("saveMixToLibBtn");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.textContent = "Guardando...";
        saveBtn.disabled = true;

        await saveToLibrary(finalWavBlob, {
          name: `Mezcla - ${trackFile.name || "Canción"}`,
          type: "grabacion"
        });

        saveBtn.textContent = "✅ ¡Guardado en Biblioteca!";
      };
    }
  } catch (err) {
    console.error("Error al mezclar los flujos multimedia:", err);
    if (resultDiv) resultDiv.innerHTML = "<p style='color: #ef4444;'>❌ Hubo un error al mezclar los audios.</p>";
  } finally {
    if (btn) { btn.textContent = "🎧 Mezclar Pista + Voz"; btn.disabled = false; }
  }
}
