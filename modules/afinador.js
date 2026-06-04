const pitchBuffer = new Float32Array(2048);
let pitchHistory = [];
let pitchHistoryMic1 = [];
let pitchHistoryMic2 = [];

let isPitchDetectionRunning = false;
let micTestAudioContext = null;
let micTestAnimationId = null;
let micTestStream = null;
