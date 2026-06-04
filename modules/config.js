import { $ } from '../script.js';

// CORRECCIÓN PROTECTORA: Declaramos las variables de control de pruebas al inicio del módulo
let micTestAudioContext = null;
let micTestStream = null;
let micTestAnalyser = null;
let micTestAnimationId = null;

/**
 * Burbuja visual flotante que avisa al usuario que sus configuraciones se guardaron con éxito
 */
export function showSaveNotification() {
  const notif = $("saveNotification");
  if (notif) {
    notif.classList.add("show");
    setTimeout(() => {
      notif.classList.remove("show");
    }, 2000);
  } else {
    console.log("⚡ Configuración sincronizada y guardada en LocalStorage.");
  }
}

/**
 * Modifica los atributos de datos del DOM para alterar las variables CSS del tema principal
 */
export function applyAppTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.setAttribute("data-theme", theme);
  console.log("🎨 Tema aplicado de forma nativa:", theme);
}

/**
 * Guarda las claves básicas del formulario directamente en la persistencia local
 */
export function saveSetting(key, element) {
  if (!element) return;
  localStorage.setItem(key, element.value);
  showSaveNotification();
}

/**
 * Carga las preferencias del usuario al iniciar la aplicación y enlaza los eventos de cambio
 */
export function initSettings() {
  const sensInput = $("micSensitivity");
  if (sensInput) {
    sensInput.value = localStorage.getItem("singIt_sensitivity") || "0.015";
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("singIt_sensitivity", e.target.value);
    });
  }

  // Mapeo unificado de IDs de HTML con sus respectivas claves de LocalStorage
  const settings = {
    micCount: "singIt_micCount",
    karaokeThemeSelect: "singIt_stage",
    difficultyLevel: "singIt_difficulty",
    karaokeDifficultyLevel: "singIt_karaoke_difficulty", // ID único corregido
    userVoiceType: "singIt_voiceType",
    appTheme: "singIt_theme"
  };

  Object.entries(settings).forEach(([id, storageKey]) => {
    const el = $(id);
    if (el) {
      const saved = localStorage.getItem(storageKey);
      if (saved) el.value = saved;
      
      el.addEventListener("change", (e) => {
        localStorage.setItem(storageKey, e.target.value);
        showSaveNotification();
        
        if (id === "appTheme") {
          applyAppTheme(e.target.value);
        }
        
        if (id === "karaokeThemeSelect") {
          const contenedorKaraoke = document.getElementById("karaokeLiveLyrics") || document.getElementById("karaokeLyrics") || document.querySelector(".karaoke-lyrics");
          if (contenedorKaraoke) {
            const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];
            todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
            contenedorKaraoke.classList.add(e.target.value);
          }
        }
      });
    }
  });

  // OPTIMIZACIÓN DE ARRANQUE: Forzamos la sincronización visual inmediata al abrir la app
  applyAppTheme(localStorage.getItem("singIt_theme") || "oscuro");
  inicializarEscenarioDesdeMemoria();
}

/**
 * Solicita permisos de hardware, enumera los dispositivos de entrada de audio y llena los selectores
 */
export async function loadAvailableMics() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === "audioinput");

    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");

    if (mic1Select) {
      mic1Select.innerHTML = "";
      if (mics.length === 0) {
        mic1Select.innerHTML = `<option value="">No se detectaron micrófonos</option>`;
      } else {
        mics.forEach((mic, index) => {
          const option = document.createElement("option");
          option.value = mic.deviceId;
          option.textContent = mic.label || `Micrófono ${index + 1}`;
          mic1Select.appendChild(option);
        });
      }

      const savedMic1 = localStorage.getItem("singIt_mic1");
      if (savedMic1) mic1Select.value = savedMic1;

      mic1Select.addEventListener("change", (e) => {
        localStorage.setItem("singIt_mic1", e.target.value);
        console.log("🔒 Micrófono 1 guardado en memoria local.");
      });
    }

    if (mic2Select) {
      mic2Select.innerHTML = "";
      if (mics.length === 0) {
        mic2Select.innerHTML = `<option value="">No se detectaron micrófonos</option>`;
      } else {
        mics.forEach((mic, index) => {
          const option = document.createElement("option");
          option.value = mic.deviceId;
          option.textContent = mic.label || `Micrófono ${index + 1}`;
          mic2Select.appendChild(option);
        });
      }

      const savedMic2 = localStorage.getItem("singIt_mic2");
      if (savedMic2) mic2Select.value = savedMic2;

      mic2Select.addEventListener("change", (e) => {
        localStorage.setItem("singIt_mic2", e.target.value);
        console.log("🔒 Micrófono 2 guardado en memoria local.");
      });
    }

    console.log("🎙️ Micrófonos detectados y sincronizados:", mics.length);
  } catch (error) {
    console.error("Error crítico al enumerar los micrófonos del sistema:", error);
    
    const mic1Select = $("mic1Select");
    const mic2Select = $("mic2Select");
    
    if (mic1Select) mic1Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
    if (mic2Select) mic2Select.innerHTML = `<option value="">⚠️ Permite acceso al micrófono</option>`;
  }
}

/**
 * Controla si el bloque HTML del segundo micrófono debe mostrarse u ocultarse según el modo (Dúo o Mono)
 */
export function toggleMic2Visibility() {
  const micCount = $("micCount");
  const mic2Group = $("mic2Group");

  if (micCount && mic2Group) {
    if (micCount.value === "2") {
      mic2Group.style.display = "block";
    } else {
      mic2Group.style.display = "none";
    }
  }
}

/**
 * Extrae el identificador del hardware seleccionado en los selectores desplegables
 */
export function getSelectedMicId(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const select = $(selectId);
  return select ? select.value : null;
}

/**
 * Persiste la selección manual de un micrófono específico en las opciones del LocalStorage
 */
export function saveMicSelection(micNumber) {
  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const storageKey = micNumber === 1 ? "singIt_mic1" : "singIt_mic2";

  const select = $(selectId);
  if (select) {
    localStorage.setItem(storageKey, select.value);
    showSaveNotification();
  }
}

/**
 * Apaga el flujo de pruebas multimedia cerrando el contexto y liberando el micrófono físico
 */
export function stopMicTest() {
  if (micTestAnimationId) {
    cancelAnimationFrame(micTestAnimationId);
    micTestAnimationId = null;
  }

  if (micTestStream) {
    micTestStream.getTracks().forEach(track => track.stop());
    micTestStream = null;
  }

  if (micTestAudioContext) {
    micTestAudioContext.close().catch(() => {});
    micTestAudioContext = null;
  }

  micTestAnalyser = null;

  const fills = document.querySelectorAll(".mic-level-fill");
  fills.forEach(fill => {
    fill.style.width = "0%";
    fill.classList.remove("active");
  });
}

/**
 * Abre el hardware del micrófono seleccionado y pinta una barra visual de nivel durante 5 segundos
 */
export async function testMicrophone(micNumber) {
  stopMicTest(); // Limpieza preventiva

  const selectId = micNumber === 1 ? "mic1Select" : "mic2Select";
  const levelId = micNumber === 1 ? "mic1Level" : "mic2Level";

  const select = $(selectId);
  const levelBar = $(levelId);

  if (!select || !levelBar) return;

  const deviceId = select.value;
  if (!deviceId) {
    alert("⚠️ Selecciona un micrófono primero");
    return;
  }

  try {
    const constraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    micTestStream = await navigator.mediaDevices.getUserMedia(constraints);
    micTestAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    const source = micTestAudioContext.createMediaStreamSource(micTestStream);
    micTestAnalyser = micTestAudioContext.createAnalyser();
    micTestAnalyser.fftSize = 2048;
    source.connect(micTestAnalyser);

    const levelFill = levelBar.querySelector(".mic-level-fill");
    if (levelFill) {
      levelFill.classList.add("active");
    }

    function updateLevel() {
      if (!micTestAnalyser) return;

      const dataArray = new Uint8Array(micTestAnalyser.frequencyBinCount);
      micTestAnalyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const percentage = Math.min(100, (average / 128) * 100);

      if (levelFill) {
        levelFill.style.width = percentage + "%";
      }

      micTestAnimationId = requestAnimationFrame(updateLevel);
    }

    updateLevel();

    setTimeout(() => {
      stopMicTest();
    }, 5000);

  } catch (error) {
    console.error("Error al probar hardware de micrófono:", error);
    alert("❌ No se pudo acceder al micrófono seleccionado. Verifica los permisos.");
  }
}

/**
 * Inicialización fija del escenario guardado en disco duro de forma unificada
 */
export function inicializarEscenarioDesdeMemoria() {
  const select = document.getElementById("karaokeThemeSelect");
  const contenedorKaraoke = document.getElementById("karaokeLiveLyrics") || document.getElementById("karaokeLyrics") || document.querySelector(".karaoke-lyrics");
  if (!select || !contenedorKaraoke) return;

  let temaGuardado = localStorage.getItem("singIt_stage") || "theme-clasico";
  if (temaGuardado === "undefined") temaGuardado = "theme-clasico";

  select.value = temaGuardado; 

  const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta", "theme-retrowave"];
  todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
  contenedorKaraoke.classList.add(temaGuardado);
}
