// modules/config.js

// Función auxiliar para notificar cambios guardados
function showSaveNotification() {
  // Si tienes una lógica visual para la notificación, ponla aquí. 
  // Por ahora dejamos un log para evitar que la app se rompa si no existe.
  console.log("Configuración guardada automáticamente.");
}

// Función auxiliar para aplicar el tema visual de la aplicación
function applyAppTheme(themeName) {
  document.body.className = `theme-${themeName}`;
}

export function initSettings() {
  const sensInput = document.getElementById("micSensitivity");
  if (sensInput) {
    sensInput.value = localStorage.getItem("singIt_sensitivity") || "0.015";
    sensInput.addEventListener("input", (e) => {
      localStorage.setItem("singIt_sensitivity", e.target.value);
    });
  }

  const settings = {
    micCount: "singIt_micCount",
    karaokeThemeSelect: "singIt_stage",
    difficultyLevel: "singIt_difficulty",
    userVoiceType: "singIt_voiceType",
    appTheme: "singIt_theme"
  };

  Object.entries(settings).forEach(([id, storageKey]) => {
    const el = document.getElementById(id);
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
          const contenedorKaraoke = document.querySelector(".karaoke-lyrics");
          if (contenedorKaraoke) {
            const todosLosTemas = ["theme-clasico", "theme-moderno", "theme-disco", "theme-acustico", "theme-fiesta"];
            todosLosTemas.forEach(tema => contenedorKaraoke.classList.remove(tema));
            contenedorKaraoke.classList.add(e.target.value);
          }
        }
      });
    }
  });
}
