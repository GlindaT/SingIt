let transcriptionSegments = [];
let baseTranscriptionSegments = [];
let autoScrollEnabled = true; // Control de auto-scroll

// Variables para sincronización con Taps
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

// Función para animación visual del Tap
export function handleTap() {
    const elements = [document.getElementById('tapCurrentLine'), document.getElementById('tapProgress')];
    
    elements.forEach(el => {
        if (el) {
            // Remueve la clase para reiniciar la animación
            el.classList.remove('tap-active');
            // Forzar reflow en el navegador para reiniciar la animación
            void el.offsetWidth; 
            // Re-añadir la clase
            el.classList.add('tap-active');
        }
    });
}
