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
