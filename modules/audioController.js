export class AudioProcessorController {
  constructor(workerPath = '../audio-processor.worker.js') { // Ruta relativa exacta desde la carpeta modules/
    this.worker = new Worker(workerPath);
    this.pendingRequests = new Map();
    this.requestId = 0;

    // Escuchador de respuestas provenientes del Web Worker secundario
    this.worker.onmessage = (event) => {
      const { id, result, error, success } = event.data;
      const request = this.pendingRequests.get(id);

      if (!request) return;

      if (success) {
        request.resolve(result);
      } else {
        request.reject(new Error(error));
      }

      this.pendingRequests.delete(id);
    };

    this.worker.onerror = (error) => {
      console.error('Audio Worker Error:', error);
    };
  }

  /**
   * Envía comandos estructurados y retorna promesas asíncronas
   */
  async execute(command, data) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.worker.postMessage({ command, data, id });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Mezclador de audio multicanal en diferido
   */
  async mixAudio(buffers, gains = null) {
    const bufferData = buffers.map(b => ({
      buffer: b instanceof Float32Array ? b : new Float32Array(b)
    }));

    const result = await this.execute('mix', {
      buffers: bufferData.map(b => b.buffer),
      gains
    });

    return new Float32Array(result);
  }

  /**
   * Envía fragmentos de audio para detección del Pitch matemático
   */
  async detectPitch(buffer, sampleRate) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    return await this.execute('detectPitch', {
      buffer: floatBuffer,
      sampleRate
    });
  }

  /**
   * Altera la amplitud (volumen) de un arreglo tipado
   */
  async applyGain(buffer, gain) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('applyGain', { buffer: floatBuffer, gain });
    return new Float32Array(result);
  }

  /**
   * Filtro digital paso bajo offline
   */
  async applyLowPassFilter(buffer, cutoffFrequency, sampleRate) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('lowPassFilter', { buffer: floatBuffer, cutoffFrequency, sampleRate });
    return new Float32Array(result);
  }

  /**
   * Analizador rápido de silencios y compresión
   */
  async detectSilence(buffer, threshold = 0.01) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    return await this.execute('detectSilence', { buffer: floatBuffer, threshold });
  }

  /**
   * Normalizador dinámico de decibelios
   */
  async normalizeAudio(buffer, targetLevel = 0.9) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const result = await this.execute('normalize', { buffer: floatBuffer, targetLevel });
    return new Float32Array(result);
  }

  /**
   * Segmentación de buffers pesados para protección de memoria caché
   */
  async processInChunks(buffer, chunkSize = 4096) {
    const floatBuffer = buffer instanceof Float32Array ? buffer : new Float32Array(buffer);
    const chunks = await this.execute('processChunks', { buffer: floatBuffer, chunkSize });
    return chunks.map(c => new Float32Array(c));
  }

  terminate() {
    this.worker.terminate();
  }
}

// Instancia única (Singleton) compartida de forma perezosa por toda la aplicación
let audioController = null;

// Exportación de ES Modules limpia y oficial
export function getAudioController() {
  if (!audioController) {
    audioController = new AudioProcessorController();
  }
  return audioController;
}
