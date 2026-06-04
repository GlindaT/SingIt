import { $ } from '../script.js';

/**
 * Función auxiliar interna para limpiar guiones y unir palabras de forma fluida
 */
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

/**
 * MOTOR DE ALTO RENDIMIENTO UNIFICADO PARA RENDERIZADO DE NOTAS Y PENTAGRAMA
 */
export class KaraokeCanvasRenderer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas with ID ${canvasId} not found`);
    this.ctx = this.canvas.getContext('2d');
    
    this.options = {
      maxFrameRate: options.maxFrameRate || 30,
      cacheSize: options.cacheSize || 100,
      ...options
    };
    
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / this.options.maxFrameRate;
    this.noteYCache = new Map();
    
    // Configuración de la rejilla matemática musical
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

  /**
   * Captura y calcula la paleta cromática exacta basándose en el LocalStorage
   */
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
  } 
  // 🔥 INYECCIÓN DE MEJORA: SOPORTE NATIVO PARA EL ESCENARIO RETROWAVE
  else if (temaActual === "theme-retrowave") {
    config = { 
      fondo: "#1e0b36",                  // Morado profundo synthwave
      lineas: "rgba(255, 0, 127, 0.25)", // Líneas neón fucsia degradadas
      etiquetas: "#38bdf8",              // Azul celeste ciberpunk para las notas
      barraFutura: "#4c1d95",            // Barras futuras moradas oscuras
      bordeFuturo: "#ff007f"             // Bordes fucsia brillante de impacto
    };
  }
  return config;
}
  }

  /**
   * Renderizado unificado de alto rendimiento optimizado con soporte DÚO y Temas visuales
   */
  render(currentTime, currentFreq, currentFreq2, transcriptionSegments) {
    if (!this.shouldRender()) return;

    const paleta = this.obtenerPaletaTema();
    const pentagramBottom = this.canvas.height - 60;
    const pentagramHeight = pentagramBottom - this.pentagramTop;

    // Guardar historiales en el entorno global para rastro de voz de forma segura
    window.pitchHistoryMic1?.push(currentFreq > 0 ? currentFreq : null);
    if (window.pitchHistoryMic1?.length > 60) window.pitchHistoryMic1.shift();

    window.pitchHistoryMic2?.push(currentFreq2 > 0 ? currentFreq2 : null);
    if (window.pitchHistoryMic2?.length > 60) window.pitchHistoryMic2.shift();

    // Limpieza de fotograma
    this.ctx.fillStyle = paleta.fondo;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Dibujar líneas de rejilla
    this.ctx.strokeStyle = paleta.lineas; 
    this.ctx.lineWidth = 1;
    const numLines = 10;
    for (let i = 0; i <= numLines; i++) {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(35, y); 
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    // Dibujar etiquetas de notas estáticas
    this.ctx.fillStyle = paleta.etiquetas; 
    this.ctx.font = "11px sans-serif";
    this.ctx.textAlign = "right";
    const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
    noteLabels.forEach((label, i) => {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i + 4;
      this.ctx.fillText(label, 28, y);
    });

    if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
      const timeWindowStart = currentTime - 1;
      const timeWindowEnd = currentTime + 5;
      const pixelsPerSecond = (this.canvas.width - 50) / 6;

      // Dibujar aguja de tiempo actual (Línea roja)
      this.ctx.strokeStyle = "#ef4444";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lineX, this.pentagramTop);
      this.ctx.lineTo(this.lineX, pentagramBottom);
      this.ctx.stroke();

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
          
          // COMPROBACIÓN PROTECTORA DÚO: Evaluación cruzada de frecuencias
          let isCorrect = false;
          if (isActive) {
            if (currentFreq && currentFreq > 0) {
              const userMidi1 = Math.round(12 * Math.log2(currentFreq / 440) + 69);
              if (Math.abs(userMidi1 - midi) <= 1) isCorrect = true; 
            }
            if (currentFreq2 && currentFreq2 > 0) {
              const userMidi2 = Math.round(12 * Math.log2(currentFreq2 / 440) + 69);
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
          
          this.ctx.fillStyle = barColor;
          this.ctx.beginPath();
          this.ctx.roundRect(wordStartX, barY - barHeight/2, barWidth, barHeight, 6);
          this.ctx.fill();
          
          this.ctx.strokeStyle = borderColor;
          this.ctx.lineWidth = isActive ? 2 : 1;
          this.ctx.stroke();
          
          this.ctx.fillStyle = textColor;
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          
          let displayWord = word.word || word.text || "";
          // TEXTO FLUIDO DINÁMICO REFINADO
          if (displayWord.length > 8) {
            this.ctx.font = isActive ? "bold 11px sans-serif" : "10px sans-serif";
          } else {
            this.ctx.font = isActive ? "bold 13px sans-serif" : "12px sans-serif";
          }
          
          this.ctx.fillText(displayWord, wordStartX + barWidth/2, barY);
        });
      });
    } else {
      this.ctx.fillStyle = paleta.etiquetas;
      this.ctx.font = "15px sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas en el pentagrama", this.canvas.width / 2, this.canvas.height / 2);
    }
  }
  handleResize() {
    this.noteYCache.clear();
  }
  // ====================================================================
// 🎤 --- DIBUJAR LA VOZ DEL MICRÓFONO 1 (AMARILLO) (CORREGIDO) ---
// ====================================================================
  
  // Dibujar rastro histórico Mic 1 (Hacia la izquierda desde la posición de canto)
  ctx.beginPath();
  ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
  ctx.lineWidth = 4; 
  let started1 = false;
  
  pitchHistoryMic1.forEach((freq, i) => {
    if (freq && freq > 0) {
      const y = midiToY(frequencyToMidi(freq));
      // CORRECCIÓN: Garantizamos el margen de desfase estático de impacto en base a píxeles seguros
      const x = 50 - (pitchHistoryMic1.length - i) * 2.5; 
      
      if (x >= 0) { 
        if (!started1) { 
          ctx.moveTo(x, y); 
          started1 = true; 
        } else { 
          ctx.lineTo(x, y); 
        }
      }
    } else {
      started1 = false; // Rompe el trazo de forma limpia si hay silencio para evitar líneas locas
    }
  });
  ctx.stroke();

  // Dibujar indicador actual Mic 1 (Fijo en la zona de impacto X = 50)
  if (currentFreq && currentFreq > 0) {
    const userY1 = midiToY(frequencyToMidi(currentFreq));
    ctx.beginPath();
    ctx.fillStyle = "#facc15"; 
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#facc15";
    ctx.arc(50, userY1, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; 
  }

  // ====================================================================
  // 🐬 --- DIBUJAR LA VOZ DEL MICRÓFONO 2 (CELESTE / CIAN) (CORREGIDO) ---
  // ====================================================================
  
  // Dibujar rastro histórico Mic 2
  ctx.beginPath();
  ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
  ctx.lineWidth = 4;
  let started2 = false;
  
  pitchHistoryMic2.forEach((freq, i) => {
    if (freq && freq > 0) {
      const y = midiToY(frequencyToMidi(freq));
      const x = 50 - (pitchHistoryMic2.length - i) * 2.5; 
      
      if (x >= 0) {
        if (!started2) { 
          ctx.moveTo(x, y); 
          started2 = true; 
        } else { 
          ctx.lineTo(x, y); 
        }
      }
    } else {
      started2 = false; // Rompe el trazo de forma limpia si hay silencio
    }
  });
  ctx.stroke();

  // Dibujar indicador actual Mic 2 (Desfase en X = 56 para evitar colisiones)
  if (currentFreq2 && currentFreq2 > 0) {
    const userY2 = midiToY(frequencyToMidi(currentFreq2));
    ctx.beginPath();
    ctx.fillStyle = "#06b6d4"; 
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#06b6d4";
    ctx.arc(56, userY2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; 
  }

  // --- DIBUJAR LETRA ACTUAL ABAJO ---
  const currentIndex = transcriptionSegments.findIndex(seg => 
    currentTime >= seg.start && currentTime <= seg.end + 0.5
  );

  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

  if (currentIndex !== -1) {
    const currentSegment = transcriptionSegments[currentIndex];
    const textoActualLimpio = reconstruirFraseDesdeWords(currentSegment);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif"; 
    ctx.textAlign = "center";
    ctx.textBaseline = "top"; 
    ctx.fillText(textoActualLimpio, canvas.width / 2, canvas.height - 42);

    const nextSegment = transcriptionSegments[currentIndex + 1];
    if (nextSegment) {
      const textoProximoLimpio = reconstruirFraseDesdeWords(nextSegment);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom"; 
      ctx.fillText("Próximo: " + textoProximoLimpio, canvas.width / 2, canvas.height - 6);
    }
  } else {
    const upcomingSegment = transcriptionSegments.find(seg => seg.start > currentTime);
    if (upcomingSegment) {
      const textoProximoLimpio = reconstruirFraseDesdeWords(upcomingSegment);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle"; 
      ctx.fillText("Próximo: " + textoProximoLimpio, canvas.width / 2, canvas.height - 25);
    }
  }
}


// CORRECCIÓN REUTILIZACIÓN DE MEMORIA: Declaramos los buffers fuera del loop
const staticBufferMic1 = new Float32Array(2048);
const staticBufferMic2 = new Float32Array(2048);

// ==========================================
// DETECCIÓN DE PITCH PARA KARAOKE (CORREGIDA)
// ==========================================
async function startKaraokePitchDetection() {
    function loop() {
        const track = $("karaokeTrack");
        
        // CORRECCIÓN CONTROL FLUJO: Si la pista se detiene, pausó o finalizó, matamos el proceso inmediato de CPU
        if (!track || track.paused || track.ended || !isPitchDetectionRunning) {
            isPitchDetectionRunning = false;
            return;
        }

        const currentTime = track.currentTime;
        const sampleRateSistema = karaokeDuoAudioContext?.sampleRate || 48000;

        // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 1 (AMARILLO) ---
        let pitch1 = -1;
        if (karaokeDuoAnalyser1) {
            // Reutilizamos el buffer estático sin crear instancias nuevas
            karaokeDuoAnalyser1.getFloatTimeDomainData(staticBufferMic1);
            
            let sum1 = 0;
            for (let i = 0; i < staticBufferMic1.length; i++) { sum1 += staticBufferMic1[i] * staticBufferMic1[i]; }
            const rms1 = Math.sqrt(sum1 / staticBufferMic1.length);

            if (rms1 > 0.015) {
                pitch1 = autoCorrelate(staticBufferMic1, sampleRateSistema);
            }
        }

        // --- PROCESAMIENTO CON FILTRO DE CONFIANZA MICRÓFONO 2 (CELESTE) ---
        let pitch2 = -1; 
        if (karaokeDuoAnalyser2) {
            karaokeDuoAnalyser2.getFloatTimeDomainData(staticBufferMic2);
            
            let sum2 = 0;
            for (let i = 0; i < staticBufferMic2.length; i++) { sum2 += staticBufferMic2[i] * staticBufferMic2[i]; }
            const rms2 = Math.sqrt(sum2 / staticBufferMic2.length);

            if (rms2 > 0.015) {
                pitch2 = autoCorrelate(staticBufferMic2, sampleRateSistema);
            }
        }

        // ENVIAR AMBOS TONOS AL MONITOR VISUAL UNIFICADO
        if (typeof drawKaraokeMonitor === 'function') {
            drawKaraokeMonitor(currentTime, pitch1, pitch2);
        }

        // Ejecutamos el siguiente fotograma únicamente si la bandera sigue activa
        if (isPitchDetectionRunning) {
            requestAnimationFrame(loop);
        }
    }

    // Activamos la bandera y encendemos el motor de dibujo
    isPitchDetectionRunning = true;
    loop();
}
// ==========================================
// PARSER ULTRASTAR TXT PROFESIONAL (CORREGIDO)
// ==========================================
function parseUltrastarTxt(content) {
  const lines = content.split("\n");
  const metadata = {};
  const notes = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 1. Procesamiento de Metadatos de Cabecera
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) {
        const key = match[1].toUpperCase();
        const value = match[2].trim();
        metadata[key] = value;
      }
      continue;
    }
    
    // 2. Procesamiento de Notas y Saltos de Línea Reglamentarios
    if (trimmed.match(/^[:*F\-]/)) {
      const parts = trimmed.split(/\s+/);
      const type = parts[0]; // : = normal, * = golden, F = freestyle, - = salto de línea
      
      // CORRECCIÓN: Guardamos el salto de línea explicitamente con su Beat para segmentar con precisión
      if (type === "-") {
        notes.push({
          type: "-",
          startBeat: parseInt(parts[1], 10) || 0,
          duration: 0,
          pitch: 0,
          syllable: ""
        });
        continue;
      }
      
      if (parts.length >= 4) {
        const startBeat = parseInt(parts[1], 10);
        const duration = parseInt(parts[2], 10);
        const pitch = parseInt(parts[3], 10);
        
        // Unimos el texto remanente preservando espacios intermedios necesarios
        const syllable = parts.slice(4).join(" ");
        
        notes.push({
          type: type,
          startBeat: startBeat,
          duration: duration,
          pitch: pitch, 
          syllable: syllable
        });
      }
    }
  }
  
  return {
    title: metadata.TITLE || "Sin título",
    artist: metadata.ARTIST || "Desconocido",
    bpm: parseFloat(metadata.BPM.replace(",", ".")) || 120, // Protegido contra decimales europeos con coma
    gap: parseFloat(metadata.GAP.replace(",", ".")) || 0,   
    videoGap: parseFloat(metadata.VIDEOGAP) || 0,
    genre: metadata.GENRE || "",
    language: metadata.LANGUAGE || "",
    year: metadata.YEAR || "",
    notes: notes
  };
}

function ultrastarToSegments(parsed) {
  if (!parsed || !parsed.notes || !parsed.notes.length) {
    return [];
  }
  
  const bpm = parsed.bpm;
  const gap = parsed.gap / 1000; 
  
  // CORRECCIÓN: La resolución base por defecto en UltraStar Deluxe es multiplicar por 4
  const beatDuration = 60 / (bpm * 4); 
  
  const segments = [];
  let currentWords = [];
  
  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    
    // CORRECCIÓN: Si detectamos la marca física de corte (-), cerramos el renglón de inmediato
    if (note.type === "-") {
      if (currentWords.length > 0) {
        segments.push({
          start: currentWords[0].start,
          end: currentWords[currentWords.length - 1].end,
          text: currentWords.map(w => w.word).join(""),
          words: [...currentWords],
          pitch: currentWords[0].pitch,
          midi: currentWords[0].midi,
          note: currentWords[0].note
        });
        currentWords = []; // Vaciamos el buffer de sílabas para iniciar la siguiente línea
      }
      continue;
    }
    
    const startTime = gap + (note.startBeat * beatDuration);
    const endTime = startTime + (note.duration * beatDuration);
    
    // Conversión MIDI nativa protegida (Base estándar MIDI 60 = Do Central)
    let midiNote = 60 + note.pitch;
    
    // Corrección de límites por si el archivo viene transpuesto en octavas extremas
    if (midiNote < 12) midiNote += 12;
    if (midiNote > 127) midiNote = 127;
    
    const frecuenciaCalculada = midiToFrequency(midiNote);

    // Limpieza de guiones tipográficos estéticos del archivo UltraStar original
    let textoSilaba = note.syllable;
    
    currentWords.push({
      word: textoSilaba,
      start: startTime,
      end: endTime,
      pitch: frecuenciaCalculada,
      midi: midiNote,
      note: getNoteFromFrequency(frecuenciaCalculada)
    });
  }
  
  // Almacenar el remanente de sílabas si el archivo no incluyó la marca "-" al final
  if (currentWords.length > 0) {
    segments.push({
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: currentWords.map(w => w.word).join(""),
      words: currentWords,
      pitch: currentWords[0].pitch,
      midi: currentWords[0].midi,
      note: currentWords[0].note
    });
  }
  
  return segments;
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
import { $ } from '../script.js';
import { getLibraryItemsByType, deleteLibraryItemFromDB, getLibraryItemById } from './biblioteca.js'; // Conexión modular segura
import { stopKaraokeRecording, restartKaraokeRecording, cargarLetrasEnMonitor, startKaraokePitchDetection } from './karaoke.js'; // Referencias locales internas

// Asegúrate de enlazar con las variables globales del módulo declaradas arriba en tu archivo
let karaokeSelectedTrackBlob = null;
let karaokeSelectedTrackName = "Pista";

/**
 * PARSEADOR INTERNO: Traduce las líneas crudas de una partitura UltraStar estándar a objetos JavaScript
 */
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

/**
 * PARSEADOR INTERNO: Convierte las rejillas de Beats musicales basadas en el BPM a marcas exactas de Segundos
 */
function ultrastarToSegments(parsed) {
  const bpm = parseFloat(parsed.metadata.BPM || '120');
  const gap = parseFloat(parsed.metadata.GAP || '0') / 1000; // Milisegundos a segundos
  const beatDuration = 60 / (bpm * 4); // Resolución estándar de rejilla x4

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
      midi: note.pitch + 60 // Ajuste de transposición estándar a escala MIDI central
    });
  });

  if (currentSegment.words.length > 0) {
    currentSegment.text = currentSegment.words.map(w => w.word).join(" ").trim();
    segments.push(currentSegment);
  }
  return segments;
}

/**
 * Descarga en paralelo el archivo binario mp3 y las partituras .txt de una canción remota del catálogo
 */
export async function loadCatalogSong(folder, title, artist) {
  const status = $("karaokeStatus");
  
  try {
    if (status) status.textContent = `Estado: Deteniendo procesos anteriores...`;
    
    stopKaraokeRecording();
    restartKaraokeRecording();

    if (status) status.textContent = `Estado: Descargando archivos de "${title}"... ⏳`;
    
    // 1. Descarga remota asíncrona de las líricas UltraStar
    const syncResponse = await fetch(`./karaoke-catalog/${folder}/sync.txt`);
    if (!syncResponse.ok) throw new Error("No se pudo descargar el archivo de sincronización .txt");
    const syncContent = await syncResponse.text();
    
    const parsed = parseUltrastarTxt(syncContent);
    const segments = ultrastarToSegments(parsed);
    
    if (segments.length === 0) throw new Error("El parseador no encontró marcas numéricas estables en el archivo");
    
    // 2. Descarga remota asíncrona del archivo instrumental
    const audioResponse = await fetch(`./karaoke-catalog/${folder}/audio.mp3`);
    if (!audioResponse.ok) throw new Error("No se pudo descargar el archivo de audio instrumental");
    const audioBlob = await audioResponse.blob();
    
    // 3. Empaquetado y transferencia hacia los monitores visuales
    const track = $("karaokeTrack");
    if (track) {
      track.src = URL.createObjectURL(audioBlob);
      track.volume = 0.4;
      
      karaokeSelectedTrackBlob = audioBlob;
      karaokeSelectedTrackName = `${title} - ${artist}`;
      
      window.transcriptionSegments = segments;
      
      cargarLetrasEnMonitor();
      
      track.play()
        .then(() => {
          if (status) status.textContent = `Estado: 🎤 Reproduciendo "${title}". ¡A cantar!`;
          startKaraokePitchDetection();
        })
        .catch(err => {
          console.warn("Reproducción automática bloqueada preventivamente por el navegador:", err);
          if (status) status.textContent = `Estado: ⏸️ "${title}" cargada. Presiona el botón de iniciar para cantar.`;
        });
    }
    
    const canvas = $("karaokeCanvas");
    if (canvas) canvas.scrollIntoView({ behavior: "smooth", block: "center" });
    
    console.log("✅ Canción del catálogo cargada con éxito:", title);
    
  } catch (error) {
    console.error("Error crítico al descargar e inicializar canción remota:", error);
    if (status) status.textContent = `Estado: Error al cargar "${title}"`;
    alert(`❌ No se pudo inicializar el proyecto: ${error.message}`);
  }
}

/**
 * Renderiza dinámicamente las tarjetas de tus creaciones guardadas y tus karaokes listos para cantar
 */
export async function loadMyKaraokeSongs() {
  const container = $("myKaraokeList");
  if (!container) return;
  
  try {
    // LLAMADAS MODULARES: Consume los registros compilados directamente desde IndexedDB
    const karaokeSongs = await getLibraryItemsByType("karaoke");
    const voces = await getLibraryItemsByType("voz");
    const vocesConSync = voces.filter(v => v.transcription && v.transcription.length > 0);
    
    const allSongs = [...karaokeSongs, ...vocesConSync];
    
    if (allSongs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>No tienes canciones listas aún.</p>
          <p style="font-size: 13px;">Sincroniza una en la pestaña de Estudio.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = "";
    
    allSongs.forEach(song => {
      const div = document.createElement("div");
      div.className = "my-karaoke-item";
      
      const title = song.metadata?.title || song.name || "Sin título";
      const artist = song.metadata?.artist || "";
      
      div.innerHTML = `
        <div class="my-karaoke-item-info">
          <p class="my-karaoke-item-title">${title}</p>
          <p class="my-karaoke-item-artist">${artist || "Artista desconocido"}</p>
        </div>
        <div class="my-karaoke-item-actions">
          <button type="button" class="load-karaoke-btn" data-id="${song.id}" style="background: #22c55e;">▶️ Cantar</button>
          <button type="button" class="share-karaoke-btn" data-id="${song.id}" style="background: #8b5cf6; padding: 8px 10px;" title="Compartir como .singit">📤</button>
          <button type="button" class="delete-karaoke-btn" data-id="${song.id}" style="background: #ef4444; padding: 8px 10px;">🗑️</button>
        </div>
      `;
      
      container.appendChild(div);
    });
    
    // Asignación asíncrona de controladores de eventos sobre las tarjetas inyectadas
    container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const selectedId = Number(btn.dataset.id);
        try {
          const item = await getLibraryItemById(selectedId);
          if (item) {
            const track = $("karaokeTrack");
            if (track && item.audioBlob) {
              track.src = URL.createObjectURL(item.audioBlob);
              window.transcriptionSegments = item.transcription || [];
              cargarLetrasEnMonitor();
              track.play().then(() => startKaraokePitchDetection()).catch(() => {});
              $("karaokeStatus").textContent = `Estado: 🎤 Cantando canción propia -> ${item.name}`;
              $("karaokeCanvas")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        } catch (e) {
          console.error("Error cargando canción guardada localmente:", e);
        }
      });
    });
    
    container.querySelectorAll(".share-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (typeof window.exportKaraokeSong === "function") window.exportKaraokeSong(Number(btn.dataset.id));
      });
    });

    container.querySelectorAll(".delete-karaoke-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("¿Deseas eliminar permanentemente esta canción de tu biblioteca?")) {
          await deleteLibraryItemFromDB(Number(btn.dataset.id));
          await loadMyKaraokeSongs();
        }
      });
    });
    
  } catch (error) {
    console.error("Error crítico al compilar la vista de canciones de usuario:", error);
    container.innerHTML = `<p style="color: #ef4444;">Error al cargar tus canciones personales</p>`;
  }
}
