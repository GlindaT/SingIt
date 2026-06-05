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
window.pitchHistoryMic1 = [];
window.pitchHistoryMic2 = [];
window.isPitchDetectionRunning = false;
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
      const { loadTrackOptionsInStudio, loadVoiceOptionsInStudio } = await import("./modules/estudio.js");
      await loadTrackOptionsInStudio();
      await loadVoiceOptionsInStudio();
    }
    else if (tabId === "karaoke") {
      const { applyKaraokeTheme, loadTrackOptionsInKaraoke, cargarLetrasEnMonitor, loadMyKaraokeSongs, loadKaraokeCatalog } = await import("./modules/karaoke.js");
      applyKaraokeTheme();
      cargarLetrasEnMonitor();
      await loadTrackOptionsInKaraoke();
      await loadMyKaraokeSongs().catch(() => {});
      await loadKaraokeCatalog().catch(() => {});
    }
  } catch (error) {
    console.error(`Error crítico haciendo Lazy Import de la pestaña [${tabId}]:`, error);
  }
}

// --- 4. CONTROLADOR COMPARTIDO DEL MONITOR DE KARAOKE GRAPHICS ---
let karaokeRenderer = null;
export async function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2 = 0) {
  if (!karaokeRenderer) {
    const { KaraokeCanvasRenderer } = await import('./modules/karaoke.js');
    karaokeRenderer = new KaraokeCanvasRenderer('karaokeCanvas', {
      maxFrameRate: 30,
      enableDirtyRects: true,
      cacheSize: 100
    });
    window.addEventListener('resize', () => { if (karaokeRenderer) karaokeRenderer.handleResize(); });
  }
  
  // ALINEACIÓN MATEMÁTICA: Pasamos los argumentos en el orden exacto que espera el método render()
  karaokeRenderer.render(currentTime, currentFreq, currentFreq2, window.transcriptionSegments);
}


// ==========================================
// INIT - ENTRADA PRINCIPAL DE LA APP 
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const encabezados = document.querySelectorAll('.encabezado-desplegable');
  
  encabezados.forEach(encabezado => {
    encabezado.addEventListener('click', () => {
      const content = document.getElementById(encabezado.getAttribute('data-target'));
      const arrow = document.getElementById(encabezado.getAttribute('data-arrow'));
      if (content && arrow) {
        content.classList.toggle('oculto'); 
        arrow.classList.toggle('rotada');
      }
    });
  });

  try {
    // 1. IMPORTACIÓN DINÁMICA DE ARRANQUE SEGURO
    const { initDB, renderLibrary } = await import("./modules/biblioteca.js");
    const { initSettings, loadAvailableMics, toggleMic2Visibility, inicializarEscenarioDesdeMemoria, applyAppTheme } = await import("./modules/config.js");
    
    // 2. ENCENDEMOS LA PERSISTENCIA DE DATOS LOCAL
    await initDB();
    
    // 3. INICIALIZAMOS CONFIGURACIONES (Mapea los eventos automáticos del formulario)
    initSettings();
    
    // 4. CORRECCIÓN CRÍTICA DE APORTACIÓN CROMÁTICA: 
    // Leemos el LocalStorage y forzamos la inyección directa en el <html> y <body> al arrancar
    const temaGuardado = localStorage.getItem("singIt_theme") || "oscuro";
    applyAppTheme(temaGuardado);
    
    // 5. RESTAURAMOS EL ESCENARIO DEL KARAOKE SIEMPRE CON VALIDACIÓN DE RENDER
    inicializarEscenarioDesdeMemoria(); 
    
    // Escuchador manual para el botón de aplicar Escenario Karaoke
    safeAdd("applyKaraokeStageBtn", "click", async () => {
      const select = document.getElementById("karaokeThemeSelect");
      if (select) {
        // Forzamos el almacenamiento manual persistente en disco
        localStorage.setItem("singIt_stage", select.value);
        
        // Importamos dinámicamente el módulo para pintar la clase visual al instante
        const { inicializarEscenarioDesdeMemoria, showSaveNotification } = await import("./modules/config.js");
        inicializarEscenarioDesdeMemoria();
        showSaveNotification();
      }
    });

    // Escuchador manual para el botón de aplicar Tema Global de la App
    safeAdd("applyGlobalThemeBtn", "click", async () => {
      const select = document.getElementById("appTheme");
      if (select) {
        localStorage.setItem("singIt_theme", select.value);
        
        const { applyAppTheme, showSaveNotification } = await import("./modules/config.js");
        applyAppTheme(select.value);
        showSaveNotification();
      }
    });

    // Ajuste dinámico manual para el selector de temas de la App (Previene hilos huérfanos)
    safeAdd("appTheme", "change", async (e) => {
      const { applyAppTheme } = await import("./modules/config.js");
      applyAppTheme(e.target.value);
    });

    // Enlace de clics de la barra de navegación lateral principal
    safeAdd("btnAfinador", "click", () => showTab("afinador"));
    safeAdd("btnEstudio", "click", () => showTab("estudio"));
    safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
    safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
    safeAdd("btnSplitter", "click", () => showTab("splitter"));
    safeAdd("btnConfig", "click", () => showTab("config"));

    // Eventos Lazy del Módulo: Afinador
    safeAdd("recordBtn", "click", async () => {
      const { toggleAfinadorRecording } = await import("./modules/afinador.js");
      await toggleAfinadorRecording();
    });

    // Eventos Lazy del Módulo: Estudio de Grabación y Edición
    safeAdd("audioFile", "change", async (e) => { const { cargarAudioEstudio } = await import("./modules/estudio.js"); cargarAudioEstudio(e); });
    safeAdd("refreshStudioTrackListBtn", "click", async () => { const { loadTrackOptionsInStudio } = await import("./modules/estudio.js"); await loadTrackOptionsInStudio(); });
    safeAdd("loadStudioTrackBtn", "click", async () => { const { loadSelectedTrackFromLibraryStudio } = await import("./modules/estudio.js"); await loadSelectedTrackFromLibraryStudio(); });
    safeAdd("playTrackBtn", "click", async () => { const { playTrack } = await import("./modules/estudio.js"); playTrack(); });
    safeAdd("pauseTrackBtn", "click", async () => { const { pauseTrack } = await import("./modules/estudio.js"); pauseTrack(); });
    safeAdd("stopTrackBtn", "click", async () => { const { stopTrack } = await import("./modules/estudio.js"); stopTrack(); });
    safeAdd("startStudioRecBtn", "click", async () => { const { startStudioRecording } = await import("./modules/estudio.js"); await startStudioRecording(); });
    safeAdd("stopStudioRecBtn", "click", async () => { const { stopStudioRecording } = await import("./modules/estudio.js"); stopStudioRecording(); });
    safeAdd("redoStudioRecBtn", "click", async () => { const { redoStudioRecording } = await import("./modules/estudio.js"); redoStudioRecording(); });
    safeAdd("saveStudioRecBtn", "click", async () => { const { saveStudioRecording } = await import("./modules/estudio.js"); await saveStudioRecording(); });
    safeAdd("refreshVoiceListBtn", "click", async () => { const { loadVoiceOptionsInStudio } = await import("./modules/estudio.js"); await loadVoiceOptionsInStudio(); });
    safeAdd("loadSelectedVoiceBtn", "click", async () => { const { loadSelectedVoiceFromLibrary } = await import("./modules/estudio.js"); await loadSelectedVoiceFromLibrary(); });
    safeAdd("transcribeVoiceBtn", "click", async () => { const { transcribeSelectedVoice } = await import("./modules/estudio.js"); await transcribeSelectedVoice(); });
    safeAdd("applyCorrectedLyricsBtn", "click", async () => { const { applyCorrectedLyrics } = await import("./modules/estudio.js"); await applyCorrectedLyrics(); });

    // Conmutador del Auto-scroll
    safeAdd("toggleAutoScrollBtn", "click", () => {
      window.autoScrollEnabled = !window.autoScrollEnabled;
      const btn = $("toggleAutoScrollBtn");
      if (btn) {
        btn.textContent = window.autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
        btn.style.background = window.autoScrollEnabled ? "#f59e0b" : "#6b7280";
      }
    });

    // Eventos de Sincronización Manual por Taps (Estudio)
    safeAdd("startTapSyncBtn", "click", async () => { const { startTapSync } = await import("./modules/estudio.js"); startTapSync(); });
    safeAdd("cancelTapSyncBtn", "click", async () => { const { cancelTapSync } = await import("./modules/estudio.js"); cancelTapSync(); });
    safeAdd("tapBeatBtn", "click", async () => { const { recordTap } = await import("./modules/estudio.js"); recordTap(); });
    safeAdd("applyTapSyncBtn", "click", async () => { const { applyTapSync } = await import("./modules/estudio.js"); await applyTapSync(); });
    safeAdd("redoTapSyncBtn", "click", async () => { const { redoTapSync } = await import("./modules/estudio.js"); redoTapSync(); });

    // Eventos Lazy del Módulo: Karaoke
    safeAdd("karaokeTrackFile", "change", async (e) => { const { cargarPistaKaraoke } = await import("./modules/karaoke.js"); cargarPistaKaraoke(e); });
    safeAdd("karaokeStartBtn", "click", async () => { const { startKaraokeRecording } = await import("./modules/karaoke.js"); await startKaraokeRecording(); });
    safeAdd("karaokeStopBtn", "click", async () => { const { stopKaraokeRecording } = await import("./modules/karaoke.js"); stopKaraokeRecording(); });
    safeAdd("karaokeRestartBtn", "click", async () => { const { restartKaraokeRecording } = await import("./modules/karaoke.js"); restartKaraokeRecording(); });
    safeAdd("karaokeMixBtn", "click", async () => { const { mixKaraoke } = await import("./modules/karaoke.js"); await mixKaraoke(); });
    safeAdd("refreshKaraokeTrackBtn", "click", async () => { const { loadTrackOptionsInKaraoke } = await import("./modules/karaoke.js"); await loadTrackOptionsInKaraoke(); });
    safeAdd("loadKaraokeTrackBtn", "click", async () => { const { loadSelectedTrackFromLibraryKaraoke } = await import("./modules/karaoke.js"); await loadSelectedTrackFromLibraryKaraoke(); });

    // Escuchadores de actualización de tiempo de reproducción (Karaoke y Estudio)
    const kTrack = $("karaokeTrack");
    if (kTrack) {
      kTrack.addEventListener("timeupdate", async () => {
        const { syncKaraokeMonitor } = await import("./modules/karaoke.js");
        syncKaraokeMonitor(kTrack.currentTime);
      });
      kTrack.addEventListener("ended", async () => {
        const { syncKaraokeMonitor } = await import("./modules/karaoke.js");
        syncKaraokeMonitor(0);
      });
    }

    const player = $("player");
    if (player) {
      player.addEventListener("timeupdate", async () => {
        const { updateKaraokeHighlight } = await import("./modules/karaoke.js");
        updateKaraokeHighlight(player.currentTime);
      });
      player.addEventListener("ended", async () => {
        const { updateKaraokeHighlight } = await import("./modules/karaoke.js");
        updateKaraokeHighlight(0);
      });
    }

    // Catálogos e Importadores del Karaoke
    safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
      const { loadMyKaraokeSongs, loadKaraokeCatalog } = await import("./modules/karaoke.js");
      await loadKaraokeCatalog().catch(() => {});
      await loadMyKaraokeSongs().catch(() => {});
    });

    // Carga manual de archivos hacia la Biblioteca
    safeAdd("saveLibraryFileBtn", "click", async () => {
      const { saveManualFileToLibrary } = await import("./modules/biblioteca.js");
      await saveManualFileToLibrary();
    });
    safeAdd("libraryFileInput", "change", (e) => {
      const file = e.target.files[0];
      const nameInput = $("libraryFileName");
      if (file && nameInput && !nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.[^.]+$/, "");
      }
    });

    // Eventos Lazy del Módulo: Splitter IA
    safeAdd("splitBtn", "click", async () => {
      const { splitAudio } = await import("./modules/splitter.js");
      await splitAudio();
    });

    // Eventos de Hardware de Configuración Avanzada de Micrófonos
    safeAdd("refreshMicsBtn", "click", async () => { const { loadAvailableMics } = await import("./modules/config.js"); await loadAvailableMics(); });
    safeAdd("testMic1Btn", "click", async () => { const { testMicrophone } = await import("./modules/config.js"); await testMicrophone(1); });
    safeAdd("testMic2Btn", "click", async () => { const { testMicrophone } = await import("./modules/config.js"); await testMicrophone(2); });
    safeAdd("mic1Select", "change", async () => { const { saveMicSelection } = await import("./modules/config.js"); saveMicSelection(1); });
    safeAdd("mic2Select", "change", async () => { const { saveMicSelection } = await import("./modules/config.js"); saveMicSelection(2); });
    safeAdd("micCount", "change", async () => { const { toggleMic2Visibility } = await import("./modules/config.js"); toggleMic2Visibility(); });

    // Inicializaciones de hardware básicas de arranque rápido
    await loadAvailableMics();
    toggleMic2Visibility();

    // Precarga inicial del catálogo visual de archivos guardados
    await renderLibrary('todos');

    console.log("🚀 ¡SingIt inicializada de forma impecable y estable al 100%!");
  } catch (error) {
    console.error("Fallo general en la inicialización:", error);
    alert("❌ Error inicializando la app");
  }
});
