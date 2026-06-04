// ==========================================
// AUDIO PROCESSING CONTROLLER (Main Thread)
// ==========================================
// Manages Web Worker communication for audio operations
// File: audio-processor-controller.js

class AudioProcessorController {
  constructor(workerPath = './audio-processor.worker.js') {
    this.worker = new Worker(workerPath);
    this.pendingRequests = new Map();
    this.requestId = 0;

    // Setup worker message handler
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
   * Send command to worker and wait for result
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
   * Mix audio buffers (supports TypedArrays)
   */
  async mixAudio(buffers, gains = null) {
    // Convert buffers to transferable if needed
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
   * Detect pitch from audio buffer
   */
  async detectPitch(buffer, sampleRate) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    return await this.execute('detectPitch', {
      buffer: floatBuffer,
      sampleRate
    });
  }

  /**
   * Apply gain to audio buffer
   */
  async applyGain(buffer, gain) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    const result = await this.execute('applyGain', {
      buffer: floatBuffer,
      gain
    });

    return new Float32Array(result);
  }

  /**
   * Apply low-pass filter
   */
  async applyLowPassFilter(buffer, cutoffFrequency, sampleRate) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    const result = await this.execute('lowPassFilter', {
      buffer: floatBuffer,
      cutoffFrequency,
      sampleRate
    });

    return new Float32Array(result);
  }

  /**
   * Detect silence in buffer
   */
  async detectSilence(buffer, threshold = 0.01) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    return await this.execute('detectSilence', {
      buffer: floatBuffer,
      threshold
    });
  }

  /**
   * Normalize audio buffer
   */
  async normalizeAudio(buffer, targetLevel = 0.9) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    const result = await this.execute('normalize', {
      buffer: floatBuffer,
      targetLevel
    });

    return new Float32Array(result);
  }

  /**
   * Process large audio in chunks
   */
  async processInChunks(buffer, chunkSize = 4096) {
    const floatBuffer =
      buffer instanceof Float32Array ? buffer : new Float32Array(buffer);

    const chunks = await this.execute('processChunks', {
      buffer: floatBuffer,
      chunkSize
    });

    return chunks.map(c => new Float32Array(c));
  }

  /**
   * Terminate worker
   */
  terminate() {
    this.worker.terminate();
  }
}

// Global instance (lazy loaded)
let audioController = null;

function getAudioController() {
  if (!audioController) {
    audioController = new AudioProcessorController();
  }
  return audioController;
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioProcessorController, getAudioController };
}
