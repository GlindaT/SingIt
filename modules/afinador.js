import { getAudioController } from './audioController.js';
import { drawKaraokeMonitor, $ } from '../script.js';

// Variables de estado y buffers encapsulados en el ámbito local del módulo
const pitchBuffer = new Float32Array(2048);
let audioContext = null;
let analyser = null;
let stream = null;
let isAfinadorRunning = false;

// Variables compartidas expuestas en el objeto window para evitar colisiones
window.pitchHistoryMic1 = [];
window.pitchHistoryMic2 = [];

/**
 * UTILERÍA LOCAL: Convierte una frecuencia analítica (Hz) a una etiqueta de nota musical (ej. C4, A5)
 */
export function getNoteFromFrequency(frequency) {
  if (typeof frequency !== 'number' || !isFinite(frequency) || frequency <= 0) return "--";
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const midi = Math.round(12 * Math.log2(frequency / 440) + 69);
  if (!isFinite(midi)) return "--";
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return noteNames[noteIndex] + octave;
}

/**
 * UTILERÍA LOCAL: Traduce una nota en formato texto a su frecuencia matemática exacta en Hz
 */
function getNoteFrequency(note) {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 440; 
  const name = match[1];
  const octave = parseInt(match[2], 10);
  const semitones = noteNames.indexOf(name) + (octave + 1) * 12;
  return 440 * Math.pow(2, (semitones - 69) / 12);
}

/**
 * Controla de forma segura el interruptor de encendido del hardware desde el botón visual del panel
 */
export async function toggleAfinadorRecording() {
  const btn = $("recordBtn");
  if (!btn) return;

  if (!isAfinadorRunning) {
    isAfinadorRunning = true;
    btn.textContent = "Detener Afinador";
    btn.classList.add("recording");
    await startAfinador();
  } else {
    isAfinadorRunning = false;
    btn.textContent = "Iniciar Afinador";
    btn.classList.remove("recording");
    stopAfinador();

    if ($("noteDisplay")) $("noteDisplay").textContent = "--";
    if ($("guideText")) $("guideText").textContent = "";
  }
}

/**
 * Aplica filtros analógicos de paso alto y paso bajo para limpiar ruidos antes del análisis
 */
function aplicarCadenaDeAudio(audioCtx, source) {
  const highPass = audioCtx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 80; // Corta zumbidos graves de la habitación
 
  const lowPass = audioCtx.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = 1000; // Aísla los armónicos vocales primarios
 
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.5;
 
  source.connect(highPass);
  highPass.connect(lowPass);
 lowPass.connect(gainNode);
 
  return gainNode; 
}

/**
 * Captura el hardware de entrada y activa los nodos de análisis en el contexto web audio
 */
async function startAfinador() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, 
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    const mic = audioContext.createMediaStreamSource(stream);
    const cadenaLimpia = aplicarCadenaDeAudio(audioContext, mic);
  
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
  
    cadenaLimpia.connect(analyser);

    // Arrancar el ciclo de renderizado matemático unificado
    ejecutarCicloDeteccion();
  } catch (err) {
    console.error("No se pudo iniciar el hardware del afinador:", err);
    alert("❌ Error al acceder al micrófono. Concede permisos en tu navegador.");
    isAfinadorRunning = false;
    const btn = $("recordBtn");
    if (btn) { btn.textContent = "Iniciar Afinador"; btn.classList.remove("recording"); }
  }
}

/**
 * Apaga los flujos binarios y libera el micrófono de forma limpia
 */
function stopAfinador() {
  isAfinadorRunning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  analyser = null;
}

/**
 * Ciclo de renderizado de alta velocidad unificado: extrae audio, delega al Worker y refresca la pantalla
 */
async function ejecutarCicloDeteccion() {
  if (!isAfinadorRunning || !analyser) return;

  // Cargar datos crudos en la memoria compartida local
  analyser.getFloatTimeDomainData(pitchBuffer);
  
  try {
    const audioCtrl = getAudioController();
    // Derivación matemática al Web Worker (0% congelamiento visual)
    const pitch = await audioCtrl.detectPitch(pitchBuffer, audioContext.sampleRate);
    
    // Si el lienzo interactivo del karaoke está presente, le reportamos la nota en vivo
    if (document.getElementById("karaokeCanvas")) {
      drawKaraokeMonitor(0, pitch, 0); 
    }

    const display = $("noteDisplay");
    const guide = $("guideText");
    const targetNoteEl = $("targetNote");
    const targetNote = targetNoteEl ? targetNoteEl.value : "E2";

    if (display && guide) {
      // Validación robusta: rechaza -1, 0, NaN, Infinity y números negativos
      if (typeof pitch === 'number' && isFinite(pitch) && pitch > 0) {
        const noteFull = getNoteFromFrequency(pitch);
        const targetFreq = getNoteFrequency(targetNote);
        const cents = 1200 * Math.log2(pitch / targetFreq);

        display.textContent = noteFull;

        const dificultad = localStorage.getItem("singIt_difficulty") || "medio";
        let maxDesviation = 30;
        if (dificultad === "facil") maxDesviation = 50;
        else if (dificultad === "dificil") maxDesviation = 15;
        else if (dificultad === "experto") maxDesviation = 5;
          
        if (Math.abs(cents) <= maxDesviation) {
            display.style.color = "#22c55e"; 
            guide.textContent = `🎯 ¡En la nota! (${targetNote})`;
            guide.style.color = "#22c55e";
        } else if (cents < 0) {
            display.style.color = "#f59e0b";
            guide.textContent = `⬆️ Estás grave. Sube a ${targetNote}`;
            guide.style.color = "#f59e0b";
        } else {
            display.style.color = "#f59e0b";
            guide.textContent = `⬇️ Estás agudo. Baja a ${targetNote}`;
            guide.style.color = "#f59e0b";
        }
      } else {
        display.textContent = "--";
        display.style.color = "white";
        guide.textContent = "🎤 Esperando voz...";
      }
    }
  } catch (error) {
    console.error("Error en ciclo analítico de afinación:", error);
  }

  // Escuchar el siguiente cuadro de audio de forma recursiva
  if (isAfinadorRunning) {
    requestAnimationFrame(ejecutarCicloDeteccion);
  }
}
