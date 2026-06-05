// ==========================================
// SINGIT CORE - CENTRAL DIRECTOR (script.js)
// ==========================================

console.log("🎬 [SingIt] Cargando Cerebro Central (script.js)...");

// --- 1. UTILIDADES GLOBALES COMPARTIDAS ---
export function $(id) {
  return document.getElementById(id);
}

export function safeAdd(id, event, handler) {
  const el = $(id);
  if (el) {
    el.addEventListener(event, handler);
    console.log(`🔌 [DOM Link] Evento '${event}' enlazado con éxito al elemento ID: [${id}]`);
  } else {
    console.warn(`⚠️ [DOM Link] No se encontró el elemento ID: [${id}] para enlazar el evento '${event}'`);
  }
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
  console.log(`\n📌 [Navegación] Solicitando cambio a la pestaña: [${tabId.toUpperCase()}]`);
  
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

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

  try {
    if (tabId === "config") {
      console.log("⚙️ [Lazy Load] Cargando configuraciones de hardware...");
      const { initSettings, loadAvailableMics } = await import("./modules/config.js");
      initSettings();
      await loadAvailableMics();
    } 
    else if (tabId === "biblioteca") {
      console.log("📁 [Lazy Load] Cargando visor de Base de Datos Offline...");
      const { renderLibrary } = await import("./modules/biblioteca.js");
      await renderLibrary('todos');
    }
    else if (tabId === "splitter") {
      console.log("✂️ [Lazy Load] Módulo Splitter IA listo.");
    }
    else if (tabId === "afinador") {
      console.log("🎵 [Lazy Load] Módulo Afinador Vocal listo.");
    }
    else if (tabId === "estudio") {
      console.log("🎧 [Lazy Load] Cargando entorno de sincronización y listados...");
      const { loadTrackOptionsInStudio, loadVoiceOptionsInStudio } = await import("./modules/estudio.js");
      await loadTrackOptionsInStudio();
      await loadVoiceOptionsInStudio();
    }
    else if (tabId === "karaoke") {
      console.log("🎤 [Lazy Load] Inicializando Canvas y Playlists...");
      const { applyKaraokeTheme, loadTrackOptionsInKaraoke, cargarLetrasEnMonitor, loadMyKaraokeSongs, loadKaraokeCatalog } = await import("./modules/karaoke.js");
      applyKaraokeTheme();
      cargarLetrasEnMonitor();
      await loadTrackOptionsInKaraoke();
      await loadMyKaraokeSongs().catch(() => {});
      await loadKaraokeCatalog().catch(() => {});
    }
    console.log(`✅ [Navegación] Pestaña [${tabId.toUpperCase()}] cargada y visualizada.`);
  } catch (error) {
    console.error(`❌ [Lazy Load Error] Falló el módulo [${tabId}]:`, error);
  }
}

// --- 4. CONTROLADOR DEL MONITOR DE KARAOKE CANVA RENDER ---
let karaokeRenderer = null;
export async function drawKaraokeMonitor(currentTime, currentFreq, currentFreq2 = 0) {
  if (!karaokeRenderer) {
    console.log("🎨 [Canvas] Creando nueva instancia del renderizador gráfico unificado...");
    const { KaraokeCanvasRenderer } = await import('./modules/karaoke.js');
    karaokeRenderer = new KaraokeCanvasRenderer('karaokeCanvas', {
      maxFrameRate: 30,
      enableDirtyRects: true,
      cacheSize: 100
    });
    window.addEventListener('resize', () => { if (karaokeRenderer) karaokeRenderer.handleResize(); });
  }
  // Pasamos de forma exacta los tonos binarios al motor de dibujo
  karaokeRenderer.render(currentTime, currentFreq, currentFreq2, window.transcriptionSegments);
}

// ==========================================
// INIT - ARRANCADOR CENTRAL
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 [Boot] SingIt despertando en el DOMContentLoaded...");

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
    const { initDB } = await import("./modules/biblioteca.js");
    const { initSettings, loadAvailableMics, toggleMic2Visibility, inicializarEscenarioDesdeMemoria, applyAppTheme } = await import("./modules/config.js");
    
    console.log("💾 [Boot] Inicializando Base de Datos IndexDB...");
    await initDB();
    
    console.log("⚙️ [Boot] Cargando configuraciones persistentes del disco duro...");
    initSettings();
    inicializarEscenarioDesdeMemoria(); 

    const temaGuardado = localStorage.getItem("singIt_theme") || "oscuro";
    applyAppTheme(temaGuardado);

    // Enlace maestro de botones del menú lateral
    safeAdd("btnAfinador", "click", () => showTab("afinador"));
    safeAdd("btnEstudio", "click", () => showTab("estudio"));
    safeAdd("btnBiblioteca", "click", () => showTab("biblioteca"));
    safeAdd("btnKaraoke", "click", () => showTab("karaoke"));
    safeAdd("btnSplitter", "click", () => showTab("splitter"));
    safeAdd("btnConfig", "click", () => showTab("config"));

    // --- ENLACE DE EVENTOS COMPLEMENTARIOS (LAZY LOAD) ---
    safeAdd("recordBtn", "click", async () => {
      const { toggleAfinadorRecording } = await import("./modules/afinador.js");
      await toggleAfinadorRecording();
    });

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

    safeAdd("toggleAutoScrollBtn", "click", () => {
      window.autoScrollEnabled = !window.autoScrollEnabled;
      const btn = $("toggleAutoScrollBtn");
      if (btn) {
        btn.textContent = window.autoScrollEnabled ? "🔒 Auto-scroll: ON" : "🔓 Auto-scroll: OFF";
        btn.style.background = window.autoScrollEnabled ? "#f59e0b" : "#6b7280";
      }
    });

    safeAdd("startTapSyncBtn", "click", async () => { const { startTapSync } = await import("./modules/estudio.js"); startTapSync(); });
    safeAdd("cancelTapSyncBtn", "click", async () => { const { cancelTapSync } = await import("./modules/estudio.js"); cancelTapSync(); });
    safeAdd("tapBeatBtn", "click", async () => { const { recordTap } = await import("./modules/estudio.js"); recordTap(); });
    safeAdd("applyTapSyncBtn", "click", async () => { const { applyTapSync } = await import("./modules/estudio.js"); await applyTapSync(); });
    safeAdd("redoTapSyncBtn", "click", async () => { const { redoTapSync } = await import("./modules/estudio.js"); redoTapSync(); });
    
    safeAdd("karaokeTrackFile", "change", async (e) => { const { cargarPistaKaraoke } = await import("./modules/karaoke.js"); cargarPistaKaraoke(e); });
    safeAdd("karaokeStartBtn", "click", async () => { const { startKaraokeRecording } = await import("./modules/karaoke.js"); await startKaraokeRecording(); });
    safeAdd("karaokeStopBtn", "click", async () => { const { stopKaraokeRecording } = await import("./modules/karaoke.js"); stopKaraokeRecording(); });
    safeAdd("karaokeRestartBtn", "click", async () => {
      console.log("🔄 [script.js] Gatillando botón: Volver a intentar Karaoke");
      const { restartKaraokeRecording } = await import("./modules/karaoke.js");
      restartKaraokeRecording();
    });

    safeAdd("karaokeMixBtn", "click", async () => {
      console.log("🎧 [script.js] Gatillando botón: Mezclar Pista + Voz");
      const { mixKaraoke } = await import("./modules/karaoke.js");
      await mixKaraoke();
    });

    safeAdd("refreshKaraokeTrackBtn", "click", async () => {
      console.log("🔄 [script.js] Gatillando botón: Actualizar pistas en Karaoke");
      const { loadTrackOptionsInKaraoke } = await import("./modules/karaoke.js");
      await loadTrackOptionsInKaraoke();
    });

    safeAdd("loadKaraokeTrackBtn", "click", async () => {
      console.log("📥 [script.js] Gatillando botón: Cargar Pista de Biblioteca en Karaoke");
      const { loadSelectedTrackFromLibraryKaraoke } = await import("./modules/karaoke.js");
      await loadSelectedTrackFromLibraryKaraoke();
    });

    // --- ESCUCHADORES DE ACTUALIZACIÓN DE TIEMPO (MONITORES) ---
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

    // --- REFRESCAR CATÁLOGOS E IMPORTADORES ---
    safeAdd("refreshKaraokeCatalogBtn", "click", async () => {
      console.log("🔄 [script.js] Gatillando botón: Actualizar catálogos de Karaoke");
      const { loadMyKaraokeSongs, loadKaraokeCatalog } = await import("./modules/karaoke.js");
      await loadKaraokeCatalog().catch(() => {});
      await loadMyKaraokeSongs().catch(() => {});
    });

    // --- MÓDULO: SPLITTER IA ---
    safeAdd("splitBtn", "click", async () => {
      console.log("✂️ [script.js] Gatillando botón: Separar Audio con IA");
      const { splitAudio } = await import("./modules/splitter.js");
      await splitAudio();
    });

    // --- MÓDULO: CONFIGURACIÓN AVANZADA DE HARDWARE ---
    safeAdd("refreshMicsBtn", "click", async () => {
      console.log("🔄 [script.js] Gatillando botón: Actualizar lista de micrófonos");
      const { loadAvailableMics } = await import("./modules/config.js");
      await loadAvailableMics();
    });

    safeAdd("testMic1Btn", "click", async () => {
      console.log("🔊 [script.js] Gatillando botón: Probar Micrófono Principal");
      const { testMicrophone } = await import("./modules/config.js");
      await testMicrophone(1);
    });

    safeAdd("testMic2Btn", "click", async () => {
      console.log("🔊 [script.js] Gatillando botón: Probar Micrófono Secundario");
      const { testMicrophone } = await import("./modules/config.js");
      await testMicrophone(2);
    });

    safeAdd("mic1Select", "change", async () => {
      console.log("🎙️ [script.js] Cambio detectado en Micrófono Principal");
      const { saveMicSelection } = await import("./modules/config.js");
      saveMicSelection(1);
    });

    safeAdd("mic2Select", "change", async () => {
      console.log("🎙️ [script.js] Cambio detectado en Micrófono Secundario");
      const { saveMicSelection } = await import("./modules/config.js");
      saveMicSelection(2);
    });

    safeAdd("micCount", "change", async () => {
      console.log("🔊 [script.js] Cambio detectado en cantidad de micrófonos");
      const { toggleMic2Visibility } = await import("./modules/config.js");
      toggleMic2Visibility();
    });

    // --- INICIALIZACIONES INMEDIATAS EN SEGUNDO PLANO ---
    console.log("⚙️ [script.js] Ejecutando análisis de hardware inicial...");
    await loadAvailableMics();
    toggleMic2Visibility();

    console.log("📁 [script.js] Precargando lista visual de la Biblioteca...");
    await renderLibrary('todos');

    console.log("🚀 ¡SingIt Core inicializado de forma impecable y estable al 100%! All tabs active.");
  } catch (error) {
    console.error("❌ [script.js] Fallo general catastrófico en la inicialización:", error);
    alert("❌ Error inicializando la aplicación");
  }
});
