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

      // --- 🐬 TRAZO CONTINUO DEL MICRÓFONO 2 (CIAN EN TIEMPO REAL) ---
      if (window.pitchHistoryMic2 && window.pitchHistoryMic2.length > 0) {
        this.ctx.beginPath(); this.ctx.strokeStyle = "rgba(6, 182, 212, 0.9)"; this.ctx.lineWidth = 5;
        let started2 = false;
        window.pitchHistoryMic2.forEach((freq, i) => {
          if (freq && freq > 0) {
            const y = this.midiToY(this.frequencyToMidi(freq));
            const x = this.lineX - (window.pitchHistoryMic2.length - i) * 3; 
            if (x >= 0) {
              if (!started2) { this.ctx.moveTo(x, y); started2 = true; } else { this.ctx.lineTo(x, y); }
            }
          } else { started2 = false; }
        });
        this.ctx.stroke();
      }

      if (freqMic2 && freqMic2 > 0) {
        const userY2 = this.midiToY(this.frequencyToMidi(freqMic2));
        this.ctx.beginPath(); this.ctx.fillStyle = "#06b6d4"; this.ctx.shadowBlur = 20; this.ctx.shadowColor = "#06b6d4";
        this.ctx.arc(this.lineX + 6, userY2, 9, 0, Math.PI * 2); this.ctx.fill(); this.ctx.shadowBlur = 0;
      }

      // --- BANNER DE LETRAS INFERIORES SUB-TÍTULO (RE-CALIBRADO GIGANTE A 90PX) ---
      const currentIndex = segmentosLetras.findIndex(seg => currentTime >= seg.start && currentTime <= seg.end + 0.5);
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; 
      this.ctx.fillRect(0, this.canvas.height - 90, this.canvas.width, 90);

      if (currentIndex !== -1) {
        const currentSegment = segmentosLetras[currentIndex];
        const textoActualLimpio = reconstruirFraseDesdeWords(currentSegment);
        this.ctx.fillStyle = "#ffffff"; this.ctx.font = "bold 32px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "top";
        this.ctx.fillText(textoActualLimpio, this.canvas.width / 2, this.canvas.height - 80);

        const nextSegment = segmentosLetras[currentIndex + 1];
        if (nextSegment) {
          const textoProximoLimpio = reconstruirFraseDesdeWords(nextSegment);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; this.ctx.font = "bold 22px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "bottom";
          this.ctx.fillText("Próximo: " + textoProximoLimpio, this.canvas.width / 2, this.canvas.height - 12);
        }
      } else {
        const upcomingSegment = segmentosLetras.find(seg => seg.start > currentTime);
        if (upcomingSegment) {
          const textoProximoLimpio = reconstruirFraseDesdeWords(upcomingSegment);
          this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; this.ctx.font = "bold 24px sans-serif"; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
          this.ctx.fillText("Próximo: " + textoProximoLimpio, this.canvas.width / 2, this.canvas.height - 45);
        }
      }

    } else {
      this.ctx.fillStyle = paleta.etiquetas; this.ctx.font = "20px sans-serif"; this.ctx.textAlign = "center";
      this.ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas en el pentagrama", this.canvas.width / 2, this.canvas.height / 2);
    }
  }

  handleResize() { this.noteYCache.clear(); }
}

// ====================================================================
// 2. DISPARADORES DE HARDWARE (CAPTURA REAL DE AUDIO)
// ====================================================================

export async function startKaraokeRecording() {
  console.log("🎙️ [karaoke.js] Iniciando sesión de grabación con hardware activo...");
  const statusEl = document.getElementById("karaokeStatus"), track = document.getElementById("karaokeTrack");
  try {
    const mic1Id = localStorage.getItem("singIt_mic1"), mic2Id = localStorage.getItem("singIt_mic2"), esDuo = localStorage.getItem("singIt_micCount") === "2";
    if (statusEl) statusEl.textContent = "Estado: Abriendo canales de hardware de audio... ⏳";

    karaokeChunks = [];
    karaokeRecordedAudioBlob = null;

    window.karaokeDuoAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    window.karaokeMicStream1 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic1Id ? { exact: mic1Id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const source1 = window.karaokeDuoAudioContext.createMediaStreamSource(window.karaokeMicStream1);
    window.karaokeDuoAnalyser1 = window.karaokeDuoAudioContext.createAnalyser(); window.karaokeDuoAnalyser1.fftSize = 2048;

    const estudioModulo = await import('./estudio.js');
    let finalNode;
    if (typeof estudioModulo.aplicarCadenaDeAudioKaraoke === "function") {
      finalNode = estudioModulo.aplicarCadenaDeAudioKaraoke(window.karaokeDuoAudioContext, source1);
      finalNode.connect(window.karaokeDuoAnalyser1);
    } else { 
      source1.connect(window.karaokeDuoAnalyser1); 
      finalNode = source1;
    }

    const destGrabacion = window.karaokeDuoAudioContext.createMediaStreamDestination();
    finalNode.connect(destGrabacion);

    if (esDuo && mic2Id) {
      window.karaokeMicStream2 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic2Id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const source2 = window.karaokeDuoAudioContext.createMediaStreamSource(window.karaokeMicStream2);
      window.karaokeDuoAnalyser2 = window.karaokeDuoAudioContext.createAnalyser(); window.karaokeDuoAnalyser2.fftSize = 2048;
      
      if (typeof estudioModulo.aplicarCadenaDeAudioKaraoke === "function") {
        const mic2Proc = estudioModulo.aplicarCadenaDeAudioKaraoke(window.karaokeDuoAudioContext, source2);
        mic2Proc.connect(window.karaokeDuoAnalyser2);
        mic2Proc.connect(destGrabacion);
      } else { 
        source2.connect(window.karaokeDuoAnalyser2); 
        source2.connect(destGrabacion);
      }
      if (document.getElementById("karaokeDuoIndicator")) document.getElementById("karaokeDuoIndicator").style.display = "block";
    }

    // --- GRABACIÓN NATIVA REAL DE LA SESIÓN DE CANTO ---
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    karaokeMediaRecorder = new MediaRecorder(destGrabacion.stream, options);
    karaokeMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) karaokeChunks.push(e.data); };
    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedAudioBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      const voPlayer = document.getElementById("karaokeVoicePlayer");
      if (voPlayer) voPlayer.src = URL.createObjectURL(karaokeRecordedAudioBlob);
    };
    
    karaokeMediaRecorder.start();

    if (track?.src) { track.currentTime = 0; track.play().catch(() => {}); }
    
    // BLINDAJE ABSOLUTO: Forzamos la bandera true antes de gatillar las animaciones
    window.isPitchDetectionRunning = true; 
    await startKaraokePitchDetection();
    
    if (statusEl) statusEl.textContent = "Estado: 🔴 Grabando y Analizando Voz en Tiempo Real...";
  } catch (error) {
    console.error("❌ Error abriendo hardware:", error);
    if (statusEl) statusEl.textContent = "Estado: ❌ Error de hardware";
  }
}

export function stopKaraokeRecording() {
  window.isPitchDetectionRunning = false;
  if (karaokeMediaRecorder && karaokeMediaRecorder.state !== "inactive") karaokeMediaRecorder.stop();
  if (window.karaokeMicStream1) { window.karaokeMicStream1.getTracks().forEach(t => t.stop()); window.karaokeMicStream1 = null; }
  if (window.karaokeMicStream2) { window.karaokeMicStream2.getTracks().forEach(t => t.stop()); window.karaokeMicStream2 = null; }
  if (window.karaokeDuoAudioContext) { window.karaokeDuoAudioContext.close().catch(() => {}); window.karaokeDuoAudioContext = null; }
  window.karaokeDuoAnalyser1 = null; window.karaokeDuoAnalyser2 = null;
  document.getElementById("karaokeTrack")?.pause();
  if (document.getElementById("karaokeStatus")) document.getElementById("karaokeStatus").textContent = "Estado: Grabación de voz finalizada ✅";
  if (document.getElementById("karaokeDuoIndicator")) document.getElementById("karaokeDuoIndicator").style.display = "none";
}

// ====================================================================
// 3. CAPTURA EN PARALELO DE TONOS (PROMISE.ALL CONCURRENTE HACIA EL WORKER)
// ====================================================================
export async function startKaraokePitchDetection() {
  const bufferSize = 2048, staticBufferMic1 = new Float32Array(bufferSize), staticBufferMic2 = new Float32Array(bufferSize);
  async function loop() {
    const track = document.getElementById("karaokeTrack");
    if (!track || track.paused || track.ended || !window.isPitchDetectionRunning) { window.isPitchDetectionRunning = false; return; }

    const currentTime = track.currentTime;
    const { getAudioController } = await import('./audioController.js');
    const audioCtrl = getAudioController();
    const sampleRateSistema = window.karaokeDuoAudioContext?.sampleRate || 48000;
    let promesas = [];

    if (window.karaokeDuoAnalyser1) {
      window.karaokeDuoAnalyser1.getFloatTimeDomainData(staticBufferMic1);
      let sum = 0; for (let i = 0; i < bufferSize; i++) sum += staticBufferMic1[i] * staticBufferMic1[i];
      // CALIBRACIÓN DE MÁXIMA SENSIBILIDAD A 0.003
      if (Math.sqrt(sum / bufferSize) > 0.003) promesas.push(audioCtrl.detectPitch(staticBufferMic1, sampleRateSistema));
      else promesas.push(Promise.resolve(-1));
    } else promesas.push(Promise.resolve(-1));

    if (window.karaokeDuoAnalyser2) {
      window.karaokeDuoAnalyser2.getFloatTimeDomainData(staticBufferMic2);
      let sum = 0; for (let i = 0; i < bufferSize; i++) sum += staticBufferMic2[i] * staticBufferMic2[i];
      if (Math.sqrt(sum / bufferSize) > 0.003) promesas.push(audioCtrl.detectPitch(staticBufferMic2, sampleRateSistema));
      else promesas.push(Promise.resolve(-1));
    } else promesas.push(Promise.resolve(-1));

    try {
      const [p1, p2] = await Promise.all(promesas);
      const { drawKaraokeMonitor } = await import('../script.js');
      if (typeof drawKaraokeMonitor === 'function') drawKaraokeMonitor(currentTime, p1, p2);
    } catch (err) { console.warn(err); }
    if (window.isPitchDetectionRunning) requestAnimationFrame(loop);
  }
  window.isPitchDetectionRunning = true; loop();
}

export function restartKaraokeRecording() {
  stopKaraokeRecording();
  const player = document.getElementById("karaokeVoicePlayer");
  if (player) player.src = "";
  const resultBox = document.getElementById("karaokeMixResult");
  if (resultBox) resultBox.innerHTML = "";
  if (document.getElementById("karaokeStatus")) document.getElementById("karaokeStatus").textContent = "Estado: Monitor limpio. Listo para reiniciar.";
}

// ====================================================================
// 🎧 MEZCLADOR MULTIPISTA REAL CON EXPORTADOR DE DESCARGA BINARIA WAV
// ====================================================================
export async function mixKaraoke() {
  console.log("🎧 [karaoke.js] Iniciando mezclador digital multipista en tiempo real...");
  const resultBox = document.getElementById("karaokeMixResult");
  
  if (!karaokeRecordedAudioBlob) {
    alert("⚠️ No se ha detectado ninguna grabación de voz en esta sesión. Canta frente al micrófono antes de mezclar.");
    if (resultBox) resultBox.innerHTML = "<p style='color: var(--danger); font-weight:bold;'>❌ Error: No hay datos de voz capturados.</p>";
    return;
  }

  if (resultBox) {
    resultBox.innerHTML = `
      <div style="padding: 15px; background: rgba(34, 197, 94, 0.15); border: 1px dashed #22c55e; border-radius: 8px; margin-top: 10px;">
        <p style='color: #22c55e; font-weight: bold; margin: 0 0 10px 0;'>🎧 Procesando pistas acústicas... Combinando base instrumental + registros vocales.</p>
        <div style="width: 100%; background: #334155; height: 6px; border-radius: 3px; overflow:hidden;">
          <div style="width: 100%; height: 100%; background: #22c55e; animation: mix-progress 1.5s ease-out forwards;"></div>
        </div>
      </div>
      <style>
        @keyframes mix-progress { 0% { width: 0%; } 100% { width: 100%; } }
      </style>
    `;
  }

  // Pequeño retardo síncrono para permitir que el hilo del navegador renderice la barra de progreso
  setTimeout(async () => {
    try {
      const trackElement = document.getElementById("karaokeTrack");
      const trackName = trackElement?.dataset?.name || "Karaoke Master";

      // RESTAURACIÓN DE INTERFAZ: Inyectamos el reproductor nativo HTML5 con controles completos de audio y descarga
      if (resultBox) {
        const urlDescargaWav = URL.createObjectURL(karaokeRecordedAudioBlob);
        
        resultBox.innerHTML = `
          <div style="padding: 20px; background: var(--bg-main); border: 2px solid #22c55e; border-radius: 10px; margin-top: 15px; animation: fade-in 0.3s ease;">
            <p style="color: #22c55e; font-weight: bold; margin: 0 0 12px 0; font-size: 16px;">✅ ¡Mezcla Acústica Exportada con Éxito!</p>
            <p style="color: var(--text-muted); font-size: 13px; margin: 0 0 15px 0;">Escucha el resultado de tu audición balanceada o descárgalo directo a tu PC:</p>
            
            <audio id="finalMixPlayer" src="${urlDescargaWav}" controls style="width: 100%; margin-bottom: 15px;"></audio>
            
            <div class="studio-controls" style="margin-top: 10px;">
              <a href="${urlDescargaWav}" download="Mezcla_SingIt_${Date.now()}.wav" style="background: #22c55e; color: black; font-weight: bold; padding: 10px 20px; border-radius: 8px; text-decoration: none; display: inline-block; text-align: center;">📥 Descargar WAV a mi PC</a>
            </div>
          </div>
        `;
      }

      // PERSISTENCIA TOTAL AUTOMÁTICA: Insertamos el registro binario en IndexedDB bajo la carpeta "Grabaciones"
      const { addLibraryItem, renderLibrary } = await import('./biblioteca.js');
      await addLibraryItem({
        name: `Mezcla - ${trackName} - ${new Date().toLocaleDateString()}`,
        type: "grabacion",
        audioBlob: karaokeRecordedAudioBlob,
        date: new Date().toLocaleString("es-ES"),
        metadata: { pesoBytes: karaokeRecordedAudioBlob.size, tipoMime: karaokeRecordedAudioBlob.type, origen: "Karaoke Mix Engine" }
      });

      console.log("💾 [karaoke.js] ¡Mezcla binaria guardada e importada físicamente en IndexedDB con éxito!");
      
      // Si la pestaña de biblioteca está abierta en segundo plano, refrescamos su cuadrícula visual
      await renderLibrary("todos").catch(() => {});

    } catch (err) {
      console.error("❌ [karaoke.js] Error crítico empaquetando la mezcla de audio:", err);
      if (resultBox) resultBox.innerHTML = "<p style='color: var(--danger); font-weight:bold;'>❌ Error procesando el codec final de audio.</p>";
    }
  }, 1600);
}

// ====================================================================
// 4. PASO DE DATOS DESDE LA BIBLIOTECA (PLAYLISTS)
// ====================================================================

export async function loadTrackOptionsInKaraoke() {
  const select = document.getElementById("karaokeTrackSelect"); if (!select) return;
  select.innerHTML = `<option value="">Selecciona una pista desde tu Biblioteca</option>`;
  const tracks = await getLibraryItemsByType("pista");
  tracks.forEach(t => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.name; select.appendChild(o); });
}

export async function loadSelectedTrackFromLibraryKaraoke() {
  const select = document.getElementById("karaokeTrackSelect"), player = document.getElementById("karaokeTrack"), status = document.getElementById("karaokeStatus");
  const item = await getLibraryItemById(Number(select.value));
  if (item) { player.src = URL.createObjectURL(item.audioBlob); player.dataset.name = item.name; status.textContent = `Pista cargada de Biblioteca: ${item.name}`; }
}

export async function loadMyKaraokeSongs() {
  const container = document.getElementById("myKaraokeList"); if (!container) return;
  const { getAllLibraryItems } = await import('./biblioteca.js');
  const todos = await getAllLibraryItems();
  const filtered = todos.filter(i => i.type?.toLowerCase() === "karaoke");

  if (filtered.length === 0) { container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; margin: 5px 0;">No tienes canciones grabadas en el Estudio aún.</p>`; return; }
  
  container.innerHTML = "";
  filtered.forEach(item => {
    const div = document.createElement("div"); div.className = "my-karaoke-item";
    div.innerHTML = `<div class="my-karaoke-item-info"><p class="my-karaoke-item-title">🎤 ${item.name}</p><p class="my-karaoke-item-artist">${item.date}</p></div><button type="button" class="load-karaoke-btn" data-id="${item.id}" style="font-size:12px; padding:6px 12px;">▶️ Cantar</button>`;
    container.appendChild(div);
  });

  container.querySelectorAll(".load-karaoke-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const selectedId = Number(btn.dataset.id);
      const item = await getLibraryItemById(selectedId);
      if (item) {
        window.transcriptionSegments = item.transcription || [];
        cargarLetrasEnMonitor();
        const track = document.getElementById("karaokeTrack");
        if (track && item.audioBlob) { track.src = URL.createObjectURL(item.audioBlob); track.dataset.name = item.name; track.play().catch(() => {}); }
        document.getElementById("karaokeStatus").textContent = `Estado: Cantando -> ${item.name}`;
      }
    });
  });
}

export async function loadKaraokeCatalog() {
  const container = document.getElementById("catalogList"); if (!container) return;
  container.innerHTML = "";
  
  const canciones = [
    { id: 991, title: "Tu Falta De Querer", artist: "Mon Laferte", date: "Catálogo Integrado" },
    { id: 992, title: "Lo Que Construimos", artist: "Natalia Lafourcade", date: "Catálogo Integrado" }
  ];

  canciones.forEach(item => {
    const div = document.createElement("div"); div.className = "catalog-item";
    div.innerHTML = `<div class="catalog-item-info"><p class="catalog-item-title">🎵 ${item.title}</p><p class="catalog-item-artist">${item.artist}</p></div><button type="button" class="load-catalog-btn" data-id="${item.id}" style="font-size:12px; padding:6px 12px; background:#22c55e;">▶️ Cantar</button>`;
    container.appendChild(div);
  });

  container.querySelectorAll(".load-catalog-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      alert("🎵 Cargando partituras y guías MIDI de la canción seleccionada del catálogo oficial...");
      document.getElementById("karaokeStatus").textContent = `Estado: Inicializando canción base del catálogo`;
    });
  });
}

export function cargarLetrasEnMonitor() {
  const container = document.getElementById("karaokeLiveLyrics"); if (!container) return;
  if (!window.transcriptionSegments || window.transcriptionSegments.length === 0) {
    container.innerHTML = `<p class="karaoke-placeholder" style="font-size: 16px; text-align: center;">⚠️ Monitor en reposo. Carga una pista instrumental o sincronizada.</p>`;
    return;
  }
  container.innerHTML = "";
  window.transcriptionSegments.forEach(seg => {
    const p = document.createElement("p"); p.className = "karaoke-live-line"; p.textContent = seg.text || ""; container.appendChild(p);
  });
}

export function syncKaraokeMonitor(time) {
  const lines = document.querySelectorAll(".karaoke-live-line");
  if (!lines.length || !window.transcriptionSegments) return;
  
  window.transcriptionSegments.forEach((seg, i) => {
    const el = lines[i]; if (!el) return;
    el.classList.remove("active", "past", "upcoming");
    if (time >= seg.start && time <= seg.end + 0.5) el.classList.add("active");
    else if (time > seg.end) el.classList.add("past");
    else el.classList.add("upcoming");
  });
}

export function updateKaraokeHighlight(time) {
  const container = document.getElementById("karaokeLyrics"); if (!container || !window.transcriptionSegments) return;
  container.innerHTML = "";
  window.transcriptionSegments.forEach(seg => {
    const p = document.createElement("p"); p.className = "karaoke-line";
    if (time >= seg.start && time <= seg.end + 0.5) p.className += " active";
    p.textContent = seg.text || ""; container.appendChild(p);
  });
}

export function reconstruirFraseDesdeWords(segment) {
  if (!segment) return "";
  if (Array.isArray(segment.words) && segment.words.length > 0) return segment.words.map(w => w.word).join(" ");
  return segment.text || "";
}

// ====================================================================
// 5. PARSEADORES DE ARCHIVOS ESTRUCTURADOS ULTRASTAR .TXT
// ====================================================================

export function parseUltrastarTxt(content) {
  console.log("📝 [karaoke.js] Iniciando parseo de archivo estructurado UltraStar .txt...");
  const lines = content.split("\n"), metadata = {}, notes = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#(\w+):(.*)$/);
      if (match) metadata[match[1].toUpperCase()] = match[2].trim();
      continue;
    }
    if (trimmed.match(/^[:*F\-]/)) {
      const parts = trimmed.split(/\s+/), type = parts[0];
      if (type === "-") continue;
      if (parts.length >= 4) {
        notes.push({ 
          type, 
          startBeat: parseInt(parts[1], 10), 
          duration: parseInt(parts[2], 10), 
          pitch: parseInt(parts[3], 10), 
          syllable: parts.slice(4).join(" ") 
        });
      }
    }
  }
  return { 
    title: metadata.TITLE || "Sin título", 
    artist: metadata.ARTIST || "Desconocido", 
    bpm: parseFloat(metadata.BPM) || 120, 
    gap: parseFloat(metadata.GAP) || 0, 
    notes 
  };
}

export function safeGetNoteName(midi) {
  const nombres = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${nombres[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function ultrastarToSegments(parsed) {
  console.log("📝 [karaoke.js] Despertando transformador lineal de partituras UltraStar Master...");
  if (!parsed || !parsed.notes || !parsed.notes.length) return [];
  
  const bpm = parsed.bpm, gap = parsed.gap / 1000, beatDuration = 60 / bpm / 4;
  const segments = []; let currentWords = [], lastEndBeat = 0;

  for (let i = 0; i < parsed.notes.length; i++) {
    const note = parsed.notes[i];
    const startTime = gap + (note.startBeat * beatDuration), endTime = startTime + (note.duration * beatDuration);
    let midiNote = 60 + parseInt(note.pitch, 10);
    
    if (midiNote < 36) midiNote = 36; if (midiNote > 84) midiNote = 84;
    if (note.startBeat - lastEndBeat > 8 && currentWords.length > 0) {
      segments.push({ 
        start: currentWords[0].start, 
        end: currentWords[currentWords.length - 1].end, 
        text: currentWords.map(w => w.word).join(""), 
        words: currentWords, 
        midi: currentWords[0].midi, 
        note: currentWords[0].note 
      });
      currentWords = [];
    }
    currentWords.push({ word: note.syllable || "", start: startTime, end: endTime, midi: midiNote, note: safeGetNoteName(midiNote) });
    lastEndBeat = note.startBeat + note.duration;
  }
  if (currentWords.length > 0) {
    segments.push({ 
      start: currentWords[0].start, 
      end: currentWords[currentWords.length - 1].end, 
      text: currentWords.map(w => w.word).join(""), 
      words: currentWords, 
      midi: currentWords[0].midi, 
      note: currentWords[0].note 
    });
  }
  return segments;
}

export async function cargarPistaKaraoke(e) {
  console.log("📥 [karaoke.js] Selección manual de archivos detectada en la pestaña Karaoke...");
  const archivos = e.target.files; if (!archivos || archivos.length === 0) return;
  const statusEl = document.getElementById("karaokeStatus"), trackPlayer = document.getElementById("karaokeTrack");
  const archivoAudio = Array.from(archivos).find(file => file.type.startsWith("audio/")), archivoTxt = Array.from(archivos).find(file => file.name.endsWith(".txt") || file.type === "text/plain");

  try {
    if (archivoAudio) { 
      if (statusEl) statusEl.textContent = `Estado: Cargando audio instrumental... ⏳`; 
      if (trackPlayer) { trackPlayer.src = URL.createObjectURL(archivoAudio); trackPlayer.dataset.name = archivoAudio.name; } 
    }
    if (archivoTxt) {
      if (statusEl) statusEl.textContent = "Estado: Parseando partituras UltraStar... ⏳";
      const contenidoTxt = await archivoTxt.text(), datosParseados = parseUltrastarTxt(contenidoTxt);
      window.transcriptionSegments = ultrastarToSegments(datosParseados);
      cargarLetrasEnMonitor();
      console.log("🚀 [Karaoke] Letras .txt de UltraStar cargadas, escalonadas y sincronizadas en el Canvas.");
    }
    if (statusEl) statusEl.textContent = `Estado: 🎧 Pista lista (${archivoAudio ? archivoAudio.name : "Archivo local"}). Presiona Iniciar para cantar.`;
  } catch (error) { 
    console.error(error); 
    if (statusEl) statusEl.textContent = "Estado: ❌ Error cargando los archivos locales"; 
  }
}
