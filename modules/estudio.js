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
export function aplicarCadenaDeAudioKaraoke(audioCtx, source) {
    const highPass = audioCtx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 60; // Filtra golpes físicos al micrófono

    const compresor = audioCtx.createDynamicsCompressor();
    compresor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compresor.knee.setValueAtTime(30, audioCtx.currentTime);
    compresor.ratio.setValueAtTime(4, audioCtx.currentTime);
    compresor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compresor.release.setValueAtTime(0.25, audioCtx.currentTime);

    const shelfFilter = audioCtx.createBiquadFilter();
    shelfFilter.type = "highshelf";
    shelfFilter.frequency.value = 4000; 
    shelfFilter.gain.value = 2.0; // Brillo vocal profesional

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.4; 

    // Conexión secuencial en serie
    source.connect(highPass);
    highPass.connect(compresor);
    compresor.connect(shelfFilter);
    shelfFilter.connect(gainNode);
    
    return gainNode; 
}
