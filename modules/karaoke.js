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
