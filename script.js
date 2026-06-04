// ==========================================
// SINGIT CORE - CENTRAL DIRECTOR (script.js)
// ==========================================

// --- 1. UTILIDADES GLOBALES COMPARTIDAS ---
export function $(id) {
  return document.getElementById(id);
}

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

// --- 2. ESTADOS GLOBALES DE LA APLICACIÓN ---
window.state = {
  instrumentalUrl: null,
  letraLrc: "",
  isRecording: false
};
window.transcriptionSegments = [];
window.pitchHistory = [];
window.autoScrollEnabled = true;

// --- 3. NAVEGACIÓN PRINCIPAL ASÍNCRONA (LAZY LOADING) ---
export async function showTab(tabId) {
  // Ocultar todas las pestañas físicas en el HTML
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  // Limpiar estilos activos del sidebar
  document.querySelectorAll(".sidebar button").forEach(btn => btn.classList.remove("active"));

  const btnMap = {
    config: "btnConfig",
    biblioteca: "btnBiblioteca",
    splitter: "btnSplitter",
    afinador: "btnAfinador",
    estudio: "btnEstudio",
    karaoke: "btnKaraoke"
  };

  const activeBtn = document.getElementById(btnMap[tabId]);
  if (activeBtn) activeBtn.classList.add("active");

  // DISPARADORES DE DESCARGA BAJO DEMANDA
  try {
    const { initDB } = await import("./modules/biblioteca.js");
    const { initSettings, loadAvailableMics, toggleMic2Visibility, inicializarEscenarioDesdeMemoria } = await import("./modules/config.js");
    await initDB();
    initSettings();
    
    // Encendemos la restauración de tema unificada desde el arranque
    
    inicializarEscenarioDesdeMemoria(); 
    if (tabId === "config") {
      const { initSettings, loadAvailableMics } = await import("./modules/config.js");
      initSettings();
      await loadAvailableMics();
    } 
    else if (tabId === "biblioteca") {
      const { renderLibrary } = await import("./modules/biblioteca.js");
      await renderLibrary('todos');
    }
    else if (tabId === "splitter") {
      // Módulo Splitter listo para interactuar
    }
    else if (tabId === "afinador") {
      // Módulo Afinador listo para interactuar
    }
    else if (tabId === "estudio") {
      const { loadTrackOptionsInStudio } = await import("./modules/estudio.js");
      await loadTrackOptionsInStudio();
    }
    else if (tabId === "karaoke") {
      const { applyKaraokeTheme, loadTrackOptionsInKaraoke, cargarLetrasEnMonitor } = await import("./modules/karaoke.js");
      applyKaraokeTheme();
      cargarLetrasEnMonitor();
      await loadTrackOptionsInKaraoke();
    }
  } catch (error) {
    console.error(`Error crítico haciendo Lazy Import de la pestaña [${tabId}]:`, error);
  }
}

// --- 4. CONTROLADOR COMPARTIDO DEL MONITOR DE KARAOKE GRAPHICS ---
let karaokeRenderer = null;
export async function drawKaraokeMonitor(currentTime, currentFreq) {
  if (!karaokeRenderer) {
    const { KaraokeCanvasRenderer } = await import('./modules/karaoke.js');
    karaokeRenderer = new KaraokeCanvasRenderer('karaokeCanvas', {
      maxFrameRate: 30,
      enableDirtyRects: true,
      cacheSize: 100
    });
    window.addEventListener('resize', () => { if (karaokeRenderer) karaokeRenderer.handleResize(); });
  }
  karaokeRenderer.render(currentTime, currentFreq, window.transcriptionSegments, window.pitchHistory);
}

// ==========================================
// INIT - ENTRADA PRINCIPAL DE LA APP (CORREGIDO)
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const encabezados = document.querySelectorAll('.encabezado-desplegable');
  
  encabezados.forEach(encabezado => {
    encabezado.addEventListener('click', () => {
      const targetId = encabezado.getAttribute('data-target');
      const arrowId = encabezado.getAttribute('data-arrow');
      
      const content = document.getElementById(targetId);
      const arrow = document.getElementById(arrowId);
      
      if (content && arrow) {
        content.classList.toggle('oculto'); 
        arrow.classList.toggle('rotada');
      }
    });
  });

  try {
    await initDB();
    initSettings();

    // CORRECCIÓN PROTECTORA DE CLASES: Evita duplicidades como "theme-theme-clasico"
    function applyKaraokeTheme() {
      const themeGuardado = localStorage.getItem("singIt_stage") || "theme-clasico";
      const monitor = $("karaokeLiveLyrics");
      if (monitor) {
        // Nos aseguramos de limpiar e inyectar el formato limpio reglamentario
        const nombreLimpioTema = themeGuardado.startsWith("theme-") ? themeGuardado : "theme-" + themeGuardado;
        
        // Mantenemos la consistencia estructural con tus hojas de estilos CSS
        monitor.className = "karaoke-lyrics " + nombreLimpioTema;
      }
    }

    applyKaraokeTheme();

    safeAdd("karaokeThemeSelect", "change", (e) => {
      saveSetting("singIt_stage", e.target);
      applyKaraokeTheme();
    });

    // Navegación principal
    safeAdd("btnAfinador", "click", () => showTab("afinador"));
    safeAdd("btnEstudio", "click", () => showTab("estudio"));
    safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
    safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
    safeAdd("btnSplitter", "click", () => showTab("splitter"));
    safeAdd("btnConfig", "click", () => showTab("config"));

    // Módulo Afinador
    safeAdd("recordBtn", "click", toggleRecording);

    // Módulo Estudio de Grabación y Edición
    safeAdd("audioFile", "change", cargarAudioEstudio);
    safeAdd("refreshStudioTrackListBtn", "click", loadTrackOptionsInStudio);
    safeAdd("loadStudioTrackBtn", "click", loadSelectedTrackFromLibraryStudio);
    safeAdd("playTrackBtn", "click", playTrack);
    safeAdd("pauseTrackBtn", "click", pauseTrack);
    safeAdd("stopTrackBtn", "click", stopTrack);
    safeAdd("startStudioRecBtn", "click", startStudioRecording);
    safeAdd("stopStudioRecBtn", "click", stopStudioRecording);
    safeAdd("redoStudioRecBtn", "click", redoStudioRecording);
    safeAdd("saveStudioRecBtn", "click", saveStudioRecording);
    safeAdd("refreshVoiceListBtn", "click", loadVoiceOptionsInStudio);
    safeAdd("loadSelectedVoiceBtn", "click", loadSelectedVoiceFromLibrary);
    safeAdd("transcribeVoiceBtn", "click", transcribeSelectedVoice);
    safeAdd("applyCorrectedLyricsBtn", "click", applyCorrectedLyrics);

    // Conmutador del Auto-scroll
    safeAdd("toggleAutoScrollBtn", "click", () => {
      autoScrollEnabled = !autoScrollEnabled;
      const btn = $("toggleAutoScrollBtn");
      if (btn) {
        btn.textContent = autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
        btn.style.background = autoScrollEnabled ? "#f59e0b" : "#6b7280";
      }
    });

    // Eventos interactivos de sincronización con Taps manuales
    safeAdd("startTapSyncBtn", "click", startTapSync);
    safeAdd("cancelTapSyncBtn", "click", cancelTapSync);
    safeAdd("tapBeatBtn", "click", recordTap);
    safeAdd("applyTapSyncBtn", "click", applyTapSync);
    safeAdd("redoTapSyncBtn", "click", redoTapSync);

    // Catálogos externos de Karaoke
    safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
      if (typeof loadKaraokeCatalog === "function") await loadKaraokeCatalog();
      if (typeof loadMyKaraokeSongs === "function") await loadMyKaraokeSongs();
    });
      
    if (typeof loadKaraokeCatalog === "function") loadKaraokeCatalog();
    if (typeof loadMyKaraokeSongs === "function") loadMyKaraokeSongs();
    
    // Carga manual de archivos hacia la Biblioteca
    safeAdd("saveLibraryFileBtn", "click", saveManualFileToLibrary);
    safeAdd("libraryFileInput", "change", (e) => {
      const file = e.target.files[0];
      const nameInput = $("libraryFileName");
      if (file && nameInput && !nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.[^.]+$/, "");
      }
    });

    // Módulo de Entrenamiento Karaoke
    safeAdd("karaokeTrackFile", "change", cargarPistaKaraoke);
    safeAdd("karaokeStartBtn", "click", startKaraokeRecording);
    safeAdd("karaokeStopBtn", "click", stopKaraokeRecording);
    safeAdd("karaokeRestartBtn", "click", restartKaraokeRecording);
    safeAdd("karaokeMixBtn", "click", mixKaraoke);
    safeAdd("refreshKaraokeTrackBtn", "click", loadTrackOptionsInKaraoke);
    safeAdd("loadKaraokeTrackBtn", "click", loadSelectedTrackFromLibraryKaraoke);

    const kTrack = $("karaokeTrack");
    if (kTrack) {
      kTrack.addEventListener("timeupdate", () => {
        syncKaraokeMonitor(kTrack.currentTime);
      });

      // CORRECCIÓN: Reseteamos la caché de renderizado al finalizar la canción
      kTrack.addEventListener("ended", () => {
        lineaLiveActivaIndexCache = -1; 
        syncKaraokeMonitor(0);
      });
    }

    // Módulo de Splitter IA
    safeAdd("splitBtn", "click", splitAudio);

    // Configuración avanzada de Micrófonos
    safeAdd("refreshMicsBtn", "click", loadAvailableMics);
    safeAdd("testMic1Btn", "click", () => testMicrophone(1));
    safeAdd("testMic2Btn", "click", () => testMicrophone(2));
    safeAdd("mic1Select", "change", () => saveMicSelection(1));
    safeAdd("mic2Select", "change", () => saveMicSelection(2));
    safeAdd("micCount", "change", toggleMic2Visibility);
    
    // Inicialización del hardware al arrancar
    loadAvailableMics();
    toggleMic2Visibility();

    // Precarga de catálogos y Biblioteca local
    await renderLibrary('todos');
    await loadTrackOptionsInStudio();
    await loadTrackOptionsInKaraoke();

    const player = $("player");
    if (player) {
      player.addEventListener("timeupdate", () => {
        updateKaraokeHighlight(player.currentTime);
      });

      // CORRECCIÓN: Reseteamos la caché del monitor del Estudio al terminar la pista
      player.addEventListener("ended", () => {
        lineaActivaIndexCache = -1; 
        updateKaraokeHighlight(0);
      });
    }

    console.log("🚀 ¡SingIt inicializada de forma impecable y estable al 100%!");
  } catch (error) {
    console.error("Fallo general en la inicialización:", error);
    alert("❌ Error inicializando la app");
  }
});
