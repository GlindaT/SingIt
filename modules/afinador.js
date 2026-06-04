const pitchBuffer = new Float32Array(2048);
let pitchHistory = [];
let pitchHistoryMic1 = [];
let pitchHistoryMic2 = [];

let isPitchDetectionRunning = false;
let micTestAudioContext = null;
let micTestAnimationId = null;
let micTestStream = null;

// Importamos el controlador de audio y la utilidad $ desde sus archivos correspondientes
import { getAudioController } from './audioController.js';
import { $ } from '../script.js'; 

// Variables técnicas encapsuladas (Evita colisiones con la pestaña de Estudio)
let audioContext, analyser, stream;
const pitchBuffer = new Float32Array(2048);
let isAfinadorRunning = false;

/**
 * Controla el botón de encendido/apagado del Afinador de forma independiente
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
 * Filtra el audio nativamente antes de enviarlo al analizador matemático
 */
function aplicarCadenaDeAudio(audioCtx, source) {
 const highPass = audioCtx.createBiquadFilter();
 highPass.type = "highpass";
 highPass.frequency.value = 80; // Elimina zumbidos graves de fondo
 
 const lowPass = audioCtx.createBiquadFilter();
 lowPass.type = "lowpass";
 lowPass.frequency.value = 1000; // Corta brillos para optimizar la detección del tono
 
 const gainNode = audioCtx.createGain();
 gainNode.gain.value = 1.5;
 
 source.connect(highPass);
 highPass.connect(lowPass);
 lowPass.connect(gainNode);
 
 return gainNode; 
}

/**
 * Enciende el micrófono y arranca el ciclo de escucha
 */
async function startAfinador() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true, // Cambiado a true para mejorar la experiencia con bocinas
      noiseSuppression: true,
      autoGainControl: false
    }
  });

  const mic = audioContext.createMediaStreamSource(stream);
  const cadenaLimpia = aplicarCadenaDeAudio(audioContext, mic);
  
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  
  cadenaLimpia.connect(analyser);

  // Ciclo asíncrono de detección de tono utilizando el Web Worker
  ejecutarCicloDeteccion();
}

/**
 * Apaga el micrófono de manera segura liberando el hardware
 */
function stopAfinador() {
  isAfinadorRunning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
}

/**
 * Ciclo infinito optimizado que envía el audio al Worker para detectar la nota musical
 */
async function ejecutarCicloDeteccion() {
  if (!isAfinadorRunning || !analyser) return;

  // Extrae los datos crudos del micrófono
  analyser.getFloatTimeDomainData(pitchBuffer);

  try {
    // LLAMADA AL WORKER (Evita congelar la UI y no duplica el código del algoritmo)
    const audioCtrl = getAudioController();
    const frequency = await audioCtrl.detectPitch(pitchBuffer, audioContext.sampleRate);

    if (frequency > 0) {
      // Aquí puedes llamar a tu función para convertir Hz a nota (ej. C4, A5) y pintarla en "noteDisplay"
      actualizarInterfazAfinador(frequency);
    }
  } catch (error) {
    console.error("Error en la detección de pitch del afinador:", error);
  }

  // Siguiente fotograma de audio
  requestAnimationFrame(ejecutarCicloDeteccion);
}

function actualizarInterfazAfinador(freq) {
  const display = $("noteDisplay");
  if (display) {
    display.textContent = Math.round(freq) + " Hz";
  }
}
