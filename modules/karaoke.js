// modules/karaoke.js - PARTE 1: ARRANQUE, CONFIGURACIÓN GRÁFICA Y MÉTODO RENDER
import { $ } from '../script.js';
import { getLibraryItemById, getLibraryItemsByType } from './biblioteca.js';

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
    
    // CALIBRACIÓN MAESTRA DE DOBLE TAMAÑO (Para monitor gigante de 1800x600px)
    this.pentagramTop = 40; 
    this.midiMin = 36;      // Rango elástico extendido para notas graves masculinas
    this.midiMax = 84;      // Rango agudo limpio
    this.midiRange = this.midiMax - this.midiMin;
    this.lineX = 80;        // Aguja vertical roja desplazada a la derecha

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

    let freqMic1 = -1;
    let freqMic2 = -1;
    let segmentosLetras = window.transcriptionSegments || transcriptionSegments;

    if (typeof currentFreq === 'number') freqMic1 = currentFreq;
    if (typeof currentFreq2 === 'number') freqMic2 = currentFreq2;

    if (Array.isArray(currentFreq)) {
      segmentosLetras = currentFreq;
      freqMic1 = -1;
    }

    if (!window.pitchHistoryMic1) window.pitchHistoryMic1 = [];
    if (!window.pitchHistoryMic2) window.pitchHistoryMic2 = [];

    window.pitchHistoryMic1.push(freqMic1 > 0 ? freqMic1 : null);
    window.pitchHistoryMic2.push(freqMic2 > 0 ? freqMic2 : null);

    const maxHistory = 120;
    if (window.pitchHistoryMic1.length > maxHistory) window.pitchHistoryMic1.shift();
    if (window.pitchHistoryMic2.length > maxHistory) window.pitchHistoryMic2.shift();

    // Clear canvas
    this.ctx.fillStyle = paleta.fondo;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw staff lines
    this.ctx.strokeStyle = paleta.lineas;
    this.ctx.lineWidth = 1;
    const numLines = 10;
    for (let i = 0; i <= numLines; i++) {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i;
      this.ctx.beginPath(); this.ctx.moveTo(35, y); this.ctx.lineTo(this.canvas.width, y); this.ctx.stroke();
    }

    // Draw note labels
    this.ctx.fillStyle = paleta.etiquetas;
    this.ctx.font = "bold 20px sans-serif"; this.ctx.textAlign = "right";
    const noteLabels = ["A4", "G4", "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"];
    noteLabels.forEach((label, i) => {
      const y = this.pentagramTop + (pentagramHeight / numLines) * i + 6;
      this.ctx.fillText(label, 28, y);
    });

    // Draw playhead line
    this.ctx.strokeStyle = "#ef4444"; this.ctx.lineWidth = 2;
    this.ctx.beginPath(); this.ctx.moveTo(this.lineX, this.pentagramTop); this.ctx.lineTo(this.lineX, pentagramBottom); this.ctx.stroke();

    // Draw lyrics note bars if segments exist
    if (Array.isArray(segmentosLetras) && segmentosLetras.length > 0) {
      const timeWindowStart = currentTime - 1;
      const timeWindowEnd = currentTime + 5;
      const pixelsPerSecond = (this.canvas.width - 50) / 6;

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
            if (freqMic1 > 0) {
              if (Math.abs(this.frequencyToMidi(freqMic1) - midi) <= 2) isCorrect = true;
            }
            if (freqMic2 > 0) {
              if (Math.abs(this.frequencyToMidi(freqMic2) - midi) <= 2) isCorrect = true;
            }
          }

          let barColor, textColor, borderColor;
          if (isPast) {
            barColor = "#4b5563"; textColor = "#9ca3af"; borderColor = "#6b7280";
          } else if (isActive) {
            barColor = isCorrect ? "#22c55e" : "#3b82f6";
            textColor = "#ffffff";
            borderColor = isCorrect ? "#4ade80" : "#60a5fa";
          } else {
            barColor = paleta.barraFutura; textColor = "rgba(255, 255, 255, 0.7)"; borderColor = paleta.bordeFuturo;
          }

          this.ctx.fillStyle = barColor;
          this.ctx.strokeStyle = borderColor;
          this.ctx.lineWidth = isActive ? 2 : 1;

          try {
            this.ctx.beginPath();
            this.ctx.roundRect(wordStartX, barY - barHeight / 2, barWidth, barHeight, 6);
            this.ctx.fill(); this.ctx.stroke();
          } catch (e) {
            this.ctx.fillRect(wordStartX, barY - barHeight / 2, barWidth, barHeight);
            this.ctx.strokeRect(wordStartX, barY - barHeight / 2, barWidth, barHeight);
          }

          this.ctx.fillStyle = textColor; this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
          const displayWord = word.word || word.text || "";
          this.ctx.font = (isActive ? "bold " : "") + (displayWord.length > 8 ? "22" : "26") + "px sans-serif";
          this.ctx.fillText(displayWord, wordStartX + barWidth / 2, barY);
        });
      });
    } else {
      this.ctx.fillStyle = paleta.etiquetas;
      this.ctx.font = "20px sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "alphabetic";
      this.ctx.fillText("Sincroniza una canción en 'Estudio' para ver las notas en el pentagrama", this.canvas.width / 2, this.canvas.height / 2);
    }

    // 4. TELEPROMPTER DOBLE LÍNEA (Abajo)
    const idx = words.findIndex(s => currentTime >= (s.start || 0) && currentTime <= (s.end || (s.start + 1)));
    if (idx !== -1) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.fillRect(0, canvas.height - 100, canvas.width, 100);
      
      ctx.textAlign = "center";
      ctx.fillStyle = "white";
      ctx.font = "bold 24px Arial";
      ctx.fillText(datos[idx].text || "", canvas.width / 2, canvas.height - 65);
      
      if (datos[idx + 1]) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "italic 18px Arial";
        ctx.fillText(datos[idx + 1].text || "", canvas.width / 2, canvas.height - 25);
      }
    }
    
    // 5. VOZ DEL USUARIO (Rastro y Punto)
    if (currentFreq > 0) {
      const userMidi = Math.round(12 * Math.log2(currentFreq / 440) + 69);
      const userY = midiToY(userMidi);
      
      ctx.beginPath();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
      ctx.lineWidth = 4;
      let started = false;
      pitchHistory.forEach((f, i) => {
        if (f) {
          const x = lineX - (pitchHistory.length - i) * 3;
          const yPos = midiToY(Math.round(12 * Math.log2(f / 440) + 69));
    
          if (x < 0) return;
          if (!started) { ctx.moveTo(x, yPos); started = true; } else { ctx.lineTo(x, yPos); }
        }
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = "#facc15";
      ctx.arc(lineX, userY, 9, 0, Math.PI * 2); 
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

    /*
    // Draw pitch trace for Mic 1 (yellow) — always drawn regardless of segments
    this._drawPitchTrace(window.pitchHistoryMic1, "rgba(250, 204, 21, 0.95)", 4);

    // Draw pitch trace for Mic 2 (cyan) — always drawn regardless of segments
    this._drawPitchTrace(window.pitchHistoryMic2, "rgba(6, 182, 212, 0.95)", 4);

  } // <-- AQUÍ CIERRA EL MÉTODO RENDER()

  _drawPitchTrace(history, color, lineWidth) {
    if (!history || history.length === 0) return;
    const totalSlots = history.length;
    // Spread trace across the left portion of the canvas (from edge to playhead)
    const traceWidth = this.lineX - 40;
    const slotWidth = traceWidth / totalSlots;

    this.ctx.beginPath();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    let started = false;
    history.forEach((freq, i) => {
      if (freq && freq > 0) {
        const y = this.midiToY(this.frequencyToMidi(freq));
        // i=0 is oldest (leftmost), i=totalSlots-1 is newest (at playhead)
        const x = 40 + i * slotWidth;
        if (!started) { this.ctx.moveTo(x, y); started = true; } else { this.ctx.lineTo(x, y); }
      } else {
        // Gap in signal — start a new sub-path next time
        if (started) { this.ctx.stroke(); this.ctx.beginPath(); started = false; }
      }
    });
    if (started) this.ctx.stroke();
  }

  handleResize() { this.noteYCache.clear(); }
} // <-- AQUÍ CIERRA DEFINITIVAMENTE LA CLASE KaraokeCanvasRenderer
*/

export async function startKaraokeRecording() {
  console.log("🎙️ [karaoke.js] Iniciando sesión de grabación con hardware activo...");
  const statusEl = document.getElementById("karaokeStatus"), track = document.getElementById("karaokeTrack");
  try {
    const mic1Id = localStorage.getItem("singIt_mic1"), mic2Id = localStorage.getItem("singIt_mic2"), esDuo = localStorage.getItem("singIt_micCount") === "2";
    if (statusEl) statusEl.textContent = "Estado: Abriendo canales de hardware de audio... ⏳";
    
    karaokeChunks = [];
    karaokeRecordedAudioBlob = null;
    window.pitchHistoryMic1 = [];
    window.pitchHistoryMic2 = [];
    
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
    
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    karaokeMediaRecorder = new MediaRecorder(destGrabacion.stream, options);
    karaokeMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) karaokeChunks.push(e.data); };
    karaokeMediaRecorder.onstop = () => {
      karaokeRecordedAudioBlob = new Blob(karaokeChunks, { type: "audio/webm" });
      const voPlayer = document.getElementById("karaokeVoicePlayer");
      if (voPlayer) voPlayer.src = URL.createObjectURL(karaokeRecordedAudioBlob);
    };
    karaokeMediaRecorder.start();
    if (track?.src) { track.currentTime = 0; /*track.play().catch(() => {});*/ }
    
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

export async function startKaraokePitchDetection() {
  const bufferSize = 2048;
  const staticBufferMic1 = new Float32Array(bufferSize);
  const staticBufferMic2 = new Float32Array(bufferSize);

  async function loop() {
    if (!window.isPitchDetectionRunning) return;

    const track = document.getElementById("karaokeTrack");
    const currentTime = track ? track.currentTime : 0;

    const { getAudioController } = await import('./audioController.js');
    const audioCtrl = getAudioController();
    const sampleRateSistema = window.karaokeDuoAudioContext?.sampleRate || 48000;
    const promesas = [];

    if (window.karaokeDuoAnalyser1) {
      window.karaokeDuoAnalyser1.getFloatTimeDomainData(staticBufferMic1);
      let sum = 0;
      for (let i = 0; i < bufferSize; i++) sum += staticBufferMic1[i] * staticBufferMic1[i];
      promesas.push(Math.sqrt(sum / bufferSize) > 0.003
        ? audioCtrl.detectPitch(staticBufferMic1, sampleRateSistema)
        : Promise.resolve(-1));
    } else {
      promesas.push(Promise.resolve(-1));
    }

    if (window.karaokeDuoAnalyser2) {
      window.karaokeDuoAnalyser2.getFloatTimeDomainData(staticBufferMic2);
      let sum = 0;
      for (let i = 0; i < bufferSize; i++) sum += staticBufferMic2[i] * staticBufferMic2[i];
      promesas.push(Math.sqrt(sum / bufferSize) > 0.003
        ? audioCtrl.detectPitch(staticBufferMic2, sampleRateSistema)
        : Promise.resolve(-1));
    } else {
      promesas.push(Promise.resolve(-1));
    }

    try {
      const [p1, p2] = await Promise.all(promesas);
      const { drawKaraokeMonitor } = await import('../script.js');
      if (typeof drawKaraokeMonitor === 'function') drawKaraokeMonitor(currentTime, p1, p2);
    } catch (err) {
      console.warn(err);
    }

    if (window.isPitchDetectionRunning) requestAnimationFrame(loop);
  }

  window.isPitchDetectionRunning = true;
  loop();
}
export function restartKaraokeRecording() {
  stopKaraokeRecording();
  const player = document.getElementById("karaokeVoicePlayer");
  if (player) player.src = "";
  const resultBox = document.getElementById("karaokeMixResult");
  if (resultBox) resultBox.innerHTML = "";
  if (document.getElementById("karaokeStatus")) document.getElementById("karaokeStatus").textContent = "Estado: Monitor limpio. Listo para reiniciar.";
}

export async function mixKaraoke() {
  console.log("🎧 [karaoke.js] Iniciando mezclador digital multipista real a tempo normal...");
  const resultBox = document.getElementById("karaokeMixResult");
  const trackElement = document.getElementById("karaokeTrack");
  
  if (!karaokeRecordedAudioBlob) {
    alert("⚠️ No se ha detectado ninguna grabación de voz. Canta frente al micrófono antes de mezclar.");
    return;
  }

  if (resultBox) {
    resultBox.innerHTML = `
      <div style="padding: 15px; background: rgba(168, 85, 247, 0.15); border: 1px dashed #a855f7; border-radius: 8px; margin-top: 10px;">
        <p style='color: #a855f7; font-weight: bold; margin: 0 0 10px 0;'>🎧 Sincronizando Sample Rates y sumando canales estéreo... ⏳</p>
        <div style="width: 100%; background: #334155; height: 6px; border-radius: 3px; overflow:hidden;">
          <div style="width: 100%; height: 100%; background: #a855f7; animation: mix-rendering 2.5s linear forwards;"></div>
        </div>
      </div>
      <style>@keyframes mix-rendering { 0% { width: 0%; } 100% { width: 100%; } }</style>
    `;
  }

  setTimeout(async () => {
    try {
      const TASA_MUESTREO_SISTEMA = window.karaokeDuoAudioContext?.sampleRate || 48000;
      const offlineCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TASA_MUESTREO_SISTEMA });
      
      const { getAudioController, exportStereoWav } = await import('./audioController.js');
      const audioCtrl = getAudioController();

      const vozArrayBuffer = await karaokeRecordedAudioBlob.arrayBuffer();
      const vozAudioBuffer = await offlineCtx.decodeAudioData(vozArrayBuffer);
      const vozFloatArray = vozAudioBuffer.getChannelData(0);

      let instrumentalFloatArray = new Float32Array(vozFloatArray.length);

      if (trackElement && trackElement.src) {
        try {
          console.log(`⏳ [karaoke.js] Descargando buffer instrumental a ${TASA_MUESTREO_SISTEMA}Hz...`);
          const resPista = await fetch(trackElement.src);
          const pistaArrayBuffer = await resPista.arrayBuffer();
          const pistaAudioBuffer = await offlineCtx.decodeAudioData(pistaArrayBuffer);
          const pistaData = pistaAudioBuffer.getChannelData(0);
          
          for (let i = 0; i < Math.min(instrumentalFloatArray.length, pistaData.length); i++) {
            instrumentalFloatArray[i] = pistaData[i];
          }
        } catch (pistaErr) {
          console.warn("⚠️ Error alineando pista de fondo, se exportará la voz sola:", pistaErr);
        }
      }

      console.log("⚙️ [karaoke.js] Transfiriendo matrices numéricas síncronas hacia el Worker...");
      const matrizMezclada = await audioCtrl.mixAudio([instrumentalFloatArray, vozFloatArray], [0.7, 1.0]);

      const renderBuffer = offlineCtx.createBuffer(2, matrizMezclada.length / 2, TASA_MUESTREO_SISTEMA);
      const renderL = renderBuffer.getChannelData(0);
      const renderR = renderBuffer.getChannelData(1);

      let idx = 0;
      for (let i = 0; i < renderBuffer.length; i++) {
        renderL[i] = matrizMezclada[idx++];
        renderR[i] = matrizMezclada[idx++];
      }

      const mezclaDefinitivaBlob = exportStereoWav(renderBuffer);
      const urlFinal = URL.createObjectURL(mezclaDefinitivaBlob);
      const trackName = trackElement?.dataset?.name || "Cancion Sincronizada";

      if (resultBox) {
        resultBox.innerHTML = `
          <div style="padding: 20px; background: var(--bg-main); border: 2px solid #a855f7; border-radius: 10px; margin-top: 15px;">
            <p style="color: #a855f7; font-weight: bold; margin: 0 0 12px 0; font-size: 16px;">🎧 ¡Mezcla Multipista Sincronizada!</p>
            <p style="color: var(--text-muted); font-size: 13px; margin: 0 0 15px 0;">Escucha tu voz combinada con la música a velocidad normal y tempo real:</p>
            
            <audio id="finalMixPlayer" src="${urlFinal}" controls style="width: 100%; margin-bottom: 15px;"></audio>
            
            <div class="studio-controls" style="margin-top: 10px;">
              <a href="${urlFinal}" download="Mezcla_Karaoke_${trackName.replace(/\s+/g, '_')}.wav" style="background: #a855f7; color: white; font-weight: bold; padding: 12px 25px; border-radius: 8px; text-decoration: none; display: inline-block; text-align: center;">📥 Descargar Mezcla Final (WAV)</a>
            </div>
          </div>
        `;
      }

      const { addLibraryItem, renderLibrary } = await import('./biblioteca.js');
      await addLibraryItem({
        name: `Mezcla - ${trackName}`,
        type: "grabacion",
        audioBlob: mezclaDefinitivaBlob,
        date: new Date().toLocaleString("es-ES")
      });

      await renderLibrary("todos").catch(() => {});
      console.log("💾 [karaoke.js] ¡Mezcla balanceada a velocidad 1:1 guardada de forma exitosa!");

    } catch (error) {
      console.error("❌ Error en el proceso de mezcla multipista:", error);
      if (resultBox) resultBox.innerHTML = "<p style='color: var(--danger); font-weight:bold;'>❌ Error procesando el renderizado de la mezcla.</p>";
    }
  }, 2600);
}

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
        if (track && item.audioBlob) { track.src = URL.createObjectURL(item.audioBlob); track.dataset.name = item.name; /*track.play().catch(() => {});*/ }
        document.getElementById("karaokeStatus").textContent = `Estado: Karaoke seleccionado -> ${item.name}`;
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
        notes.push({ type, startBeat: parseInt(parts[1], 10), duration: parseInt(parts[2], 10), pitch: parseInt(parts[3], 10), syllable: parts.slice(4).join(" ") });
      }
    }
  }
  return { title: metadata.TITLE || "Sin título", artist: metadata.ARTIST || "Desconocido", bpm: parseFloat(metadata.BPM) || 120, gap: parseFloat(metadata.GAP) || 0, notes };
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
      segments.push({ start: currentWords[0].start, end: currentWords[currentWords.length - 1].end, text: currentWords.map(w => w.word).join(""), words: currentWords, midi: currentWords[0].midi, note: currentWords[0].note });
      currentWords = [];
    }
    currentWords.push({ word: note.syllable || "", start: startTime, end: endTime, midi: midiNote, note: safeGetNoteName(midiNote) });
    lastEndBeat = note.startBeat + note.duration;
  }
  if (currentWords.length > 0) {
    segments.push({ start: currentWords[0].start, end: currentWords[currentWords.length - 1].end, text: currentWords.map(w => w.word).join(""), words: currentWords, midi: currentWords[0].midi, note: currentWords[0].note });
  }
  return segments;
}

export async function cargarPistaKaraoke(e) {
  console.log("📥 [karaoke.js] Selección manual de archivos detectada en la pestaña Karaoke...");
  const archivos = e.target.files; if (!archivos || archivos.length === 0) return;
  const statusEl = document.getElementById("karaokeStatus"), trackPlayer = document.getElementById("karaokeTrack");
  const archivoAudio = Array.from(archivos).find(file => file.type.startsWith("audio/")), archivoTxt = Array.from(archivos).find(file => file.name.endsWith(".txt") || file.type === "text/plain");

  try {
    if (archivoAudio) { if (statusEl) statusEl.textContent = `Estado: Cargando audio instrumental... ⏳`; if (trackPlayer) { trackPlayer.src = URL.createObjectURL(archivoAudio); trackPlayer.dataset.name = archivoAudio.name; } }
    if (archivoTxt) {
      if (statusEl) statusEl.textContent = "Estado: Parseando partituras UltraStar... ⏳";
      const contenidoTxt = await archivoTxt.text(), datosParseados = parseUltrastarTxt(contenidoTxt);
      window.transcriptionSegments = ultrastarToSegments(datosParseados);
      cargarLetrasEnMonitor();
      console.log("🚀 [Karaoke] Letras .txt de UltraStar cargadas, escalonadas y sincronizadas en el Canvas.");
    }
    if (statusEl) statusEl.textContent = `Estado: 🎧 Pista lista (${archivoAudio ? archivoAudio.name : "Archivo local"}). Presiona Iniciar para cantar.`;
  } catch (error) { console.error(error); if (statusEl) statusEl.textContent = "Estado: ❌ Error cargando los archivos locales"; }
}
