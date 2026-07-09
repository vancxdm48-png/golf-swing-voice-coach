const cameraFeed = document.querySelector("#cameraFeed");
const playback = document.querySelector("#playback");
const overlayCanvas = document.querySelector("#overlayCanvas");
const analysisCanvas = document.querySelector("#analysisCanvas");
const startCameraBtn = document.querySelector("#startCameraBtn");
const recordBtn = document.querySelector("#recordBtn");
const stopBtn = document.querySelector("#stopBtn");
const uploadVideo = document.querySelector("#uploadVideo");
const diagnoseBtn = document.querySelector("#diagnoseBtn");
const speakBtn = document.querySelector("#speakBtn");
const stopSpeakBtn = document.querySelector("#stopSpeakBtn");
const slowBtn = document.querySelector("#slowBtn");
const normalBtn = document.querySelector("#normalBtn");
const backFrameBtn = document.querySelector("#backFrameBtn");
const nextFrameBtn = document.querySelector("#nextFrameBtn");
const cameraStatus = document.querySelector("#cameraStatus");
const diagnosisMode = document.querySelector("#diagnosisMode");
const countdown = document.querySelector("#countdown");
const actionHint = document.querySelector("#actionHint");
const adviceText = document.querySelector("#adviceText");
const scoreValue = document.querySelector("#scoreValue");
const scoreNote = document.querySelector("#scoreNote");
const stabilityMeter = document.querySelector("#stabilityMeter");
const stabilityValue = document.querySelector("#stabilityValue");
const swayMeter = document.querySelector("#swayMeter");
const swayValue = document.querySelector("#swayValue");
const tempoMeter = document.querySelector("#tempoMeter");
const tempoValue = document.querySelector("#tempoValue");
const confidenceMeter = document.querySelector("#confidenceMeter");
const confidenceValue = document.querySelector("#confidenceValue");
const practicePlan = document.querySelector("#practicePlan");
const historyList = document.querySelector("#historyList");
const clearHistoryBtn = document.querySelector("#clearHistoryBtn");
const cameraSelect = document.querySelector("#cameraSelect");
const durationSelect = document.querySelector("#durationSelect");
const retakeBtn = document.querySelector("#retakeBtn");
const evidenceList = document.querySelector("#evidenceList");
const qualityGrid = document.querySelector("#qualityGrid");
const exportReportBtn = document.querySelector("#exportReportBtn");
const copyReportBtn = document.querySelector("#copyReportBtn");
const installBtn = document.querySelector("#installBtn");

const agentCards = {
  capture: document.querySelector("#captureAgent"),
  motion: document.querySelector("#motionAgent"),
  coach: document.querySelector("#coachAgent"),
  practice: document.querySelector("#practiceAgent"),
};

const state = {
  stream: null,
  recorder: null,
  chunks: [],
  frames: [],
  previousFrame: null,
  poseFrames: [],
  currentPose: null,
  poseEngine: {
    ready: false,
    loading: false,
    failed: false,
    landmarker: null,
    model: null,
    delegate: null,
  },
  recording: false,
  recordedUrl: "",
  sourceMode: "none",
  lastAdvice: "",
  lastReport: null,
  deferredInstallPrompt: null,
  overlayRaf: 0,
  analysisRaf: 0,
  autoStopTimer: 0,
  recordingStartedAt: 0,
  lastPoseTimestamp: 0,
  lastLivePoseAt: 0,
  speechUnlocked: false,
  sessionHistory: loadHistory(),
};

const statusLabels = {
  idle: "カメラ未接続",
  ready: "撮影できます",
  recording: "録画中",
  playback: "録画を確認中",
  error: "確認が必要",
};

function setStatus(mode, text = statusLabels[mode]) {
  cameraStatus.textContent = text;
  cameraStatus.className = `status-pill ${mode === "ready" ? "ready" : ""} ${
    mode === "recording" ? "recording" : ""
  }`;
}

function setDiagnosisMode(mode, text) {
  diagnosisMode.textContent = text;
  diagnosisMode.className = `mode-pill ${mode}`;
}

function setActionHint(text) {
  actionHint.textContent = text;
}

function setAgent(key, status, text) {
  const card = agentCards[key];
  card.className = `agent-card ${status}`;
  card.querySelector("span").textContent = text;
}

function resetAgents() {
  setAgent("capture", "", "待機中");
  setAgent("motion", "", "待機中");
  setAgent("coach", "", "待機中");
  setAgent("practice", "", "待機中");
}

function getViewMode() {
  return document.querySelector("input[name='viewMode']:checked").value;
}

function getBallSide() {
  return document.querySelector("input[name='ballSide']:checked")?.value || "left";
}

function selectedIssues() {
  return [...document.querySelectorAll(".issue-check:checked")].map(
    (input) => input.value,
  );
}

function enabledGuides() {
  return new Set(
    [...document.querySelectorAll(".guide-toggle:checked")].map((input) => input.value),
  );
}

async function startCamera() {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: cameraSelect.value,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    cameraFeed.srcObject = state.stream;
    await cameraFeed.play();
    switchToCamera();
    recordBtn.disabled = false;
    startCameraBtn.textContent = "1 カメラ再接続";
    setStatus("ready");
    setDiagnosisMode("", "手動ガイドのみ");
    setActionHint("次は「2 録画開始」を押して、1スイングしてください");
    adviceText.textContent =
      "カメラを固定して、全身とクラブが入る位置で1スイングを録画してください。";
    startOverlayLoop();
    ensurePoseEngine();
  } catch (error) {
    setStatus("error", "カメラ許可が必要");
    setDiagnosisMode("error", "動画読込に切替可");
    setActionHint("カメラ許可を確認するか、「詳細操作」から動画を読み込んでください");
    adviceText.textContent =
      "カメラを開始できませんでした。ブラウザのカメラ許可を確認するか、手元のスイング動画を読み込んで診断してください。";
  }
}

function switchToCamera() {
  playback.pause();
  playback.classList.remove("active");
  cameraFeed.classList.add("active");
}

function switchToPlayback() {
  cameraFeed.classList.remove("active");
  playback.classList.add("active");
  enablePlaybackTools(true);
}

function enablePlaybackTools(enabled) {
  slowBtn.disabled = !enabled;
  normalBtn.disabled = !enabled;
  backFrameBtn.disabled = !enabled;
  nextFrameBtn.disabled = !enabled;
}

async function startRecording() {
  if (!state.stream || state.recording) return;

  await runCountdown();
  state.chunks = [];
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;
  state.recording = true;
  state.recordingStartedAt = performance.now();
  resetAgents();

  const mimeType = pickMimeType();
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : {});

  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) state.chunks.push(event.data);
  });

  state.recorder.addEventListener("stop", finishRecording);
  state.recorder.start(150);

  recordBtn.disabled = true;
  stopBtn.disabled = false;
  diagnoseBtn.disabled = true;
  speakBtn.disabled = true;
  stopSpeakBtn.disabled = true;
  setStatus("recording");
  setDiagnosisMode("active", "自動解析準備中");
  setActionHint("スイング後に「3 停止して診断」を押してください");
  startAnalysisLoop();

  const maxDuration = Number(durationSelect.value);
  if (maxDuration > 0) {
    clearTimeout(state.autoStopTimer);
    state.autoStopTimer = setTimeout(stopRecording, maxDuration * 1000);
  }
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;
  state.recorder.stop();
  state.recording = false;
  cancelAnimationFrame(state.analysisRaf);
  clearTimeout(state.autoStopTimer);
  stopBtn.disabled = true;
}

function finishRecording() {
  if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
  const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
  state.recordedUrl = URL.createObjectURL(blob);
  state.sourceMode = "recorded";
  playback.src = state.recordedUrl;
  switchToPlayback();

  recordBtn.disabled = false;
  diagnoseBtn.disabled = false;
  retakeBtn.disabled = false;
  setStatus("playback");
  setDiagnosisMode("", "診断待ち");
  setActionHint("録画できました。自動で診断しています");
  adviceText.textContent =
    "録画できました。これから自動で診断します。";
  setTimeout(() => {
    if (!diagnoseBtn.disabled) diagnoseSwing();
  }, 150);
}

function handleVideoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
  state.recordedUrl = URL.createObjectURL(file);
  state.sourceMode = "uploaded";
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;
  playback.src = state.recordedUrl;
  playback.playbackRate = 1;
  switchToPlayback();
  diagnoseBtn.disabled = false;
  retakeBtn.disabled = false;
  speakBtn.disabled = true;
  stopSpeakBtn.disabled = true;
  setStatus("playback", "動画読込済み");
  setDiagnosisMode("", "診断待ち");
  resetAgents();
  setActionHint("動画を読み込みました。「詳細操作」の再診断で解析できます");
  adviceText.textContent =
    "動画を読み込みました。再生、コマ送り、ガイド線で確認し、診断を押してください。";
}

function runCountdown() {
  const steps = ["3", "2", "1", "Swing"];
  return new Promise((resolve) => {
    let index = 0;
    countdown.textContent = steps[index];
    const timer = setInterval(() => {
      index += 1;
      if (index >= steps.length) {
        clearInterval(timer);
        countdown.textContent = "";
        resolve();
        return;
      }
      countdown.textContent = steps[index];
    }, 650);
  });
}

function startOverlayLoop() {
  cancelAnimationFrame(state.overlayRaf);
  const ctx = overlayCanvas.getContext("2d");

  function draw() {
    resizeCanvasToElement(overlayCanvas);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    drawGuides(ctx, overlayCanvas.width, overlayCanvas.height);
    drawMotionTrace(ctx, overlayCanvas.width, overlayCanvas.height);
    drawPoseOverlay(ctx, overlayCanvas.width, overlayCanvas.height);
    maybeCaptureLivePose();
    state.overlayRaf = requestAnimationFrame(draw);
  }

  draw();
}

function nextPoseTimestamp() {
  const ts = Math.max(Math.round(performance.now()), state.lastPoseTimestamp + 1);
  state.lastPoseTimestamp = ts;
  return ts;
}

function maybeCaptureLivePose() {
  if (!state.poseEngine.ready || !state.poseEngine.landmarker || !state.stream) return;
  if (!cameraFeed.classList.contains("active") || cameraFeed.readyState < 2) return;
  const now = performance.now();
  if (now - state.lastLivePoseAt < 180) return;
  state.lastLivePoseAt = now;
  try {
    const result = state.poseEngine.landmarker.detectForVideo(cameraFeed, nextPoseTimestamp());
    const landmarks = result.landmarks?.[0];
    if (landmarks?.length) state.currentPose = landmarks;
  } catch {
    // ライブ表示は失敗しても診断に影響しないため無視する
  }
}

function drawGuides(ctx, width, height) {
  const guides = enabledGuides();
  const viewMode = getViewMode();
  const ballSide = getBallSide();
  const ballDirection = ballSide === "right" ? 1 : -1;
  const centerX = width * 0.5;
  const headY = height * 0.21;
  const shoulderY = height * 0.37;
  const hipY = height * 0.56;
  const ballY = height * 0.83;

  ctx.save();
  ctx.lineWidth = Math.max(4, width * 0.006);
  ctx.font = `800 ${Math.max(22, Math.min(42, width * 0.028))}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.88)";

  if (guides.has("ball")) {
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(width * 0.08, ballY);
    ctx.lineTo(width * 0.92, ballY);
    ctx.stroke();
    ctx.setLineDash([]);
    drawLabel(ctx, "ボール", ballSide === "right" ? width * 0.78 : width * 0.08, ballY - height * 0.06);
  }

  if (guides.has("head")) {
    ctx.strokeStyle = "rgba(64, 207, 143, 0.82)";
    ctx.strokeRect(
      centerX - width * 0.08,
      headY - height * 0.055,
      width * 0.16,
      height * 0.11,
    );
    drawLabel(ctx, "頭ゾーン", centerX - width * 0.08, headY - height * 0.085);
  }

  if (guides.has("spine")) {
    ctx.strokeStyle = "rgba(255, 208, 92, 0.9)";
    const spineStart =
      viewMode === "face"
        ? { x: centerX, y: headY + height * 0.03 }
        : { x: centerX + ballDirection * width * 0.11, y: headY + height * 0.04 };
    const spineEnd =
      viewMode === "face"
        ? { x: centerX, y: hipY }
        : { x: centerX - ballDirection * width * 0.04, y: hipY };
    ctx.beginPath();
    ctx.moveTo(spineStart.x, spineStart.y);
    ctx.lineTo(spineEnd.x, spineEnd.y);
    ctx.stroke();
    const spineLabel = viewMode === "face" ? "中心軸" : `前傾 ${lineAngleFromVertical(spineStart, spineEnd)}°`;
    drawLabel(ctx, spineLabel, spineEnd.x + ballDirection * width * 0.025, hipY - height * 0.05);
  }

  if (guides.has("shoulderHip")) {
    ctx.strokeStyle = "rgba(107, 190, 255, 0.86)";
    const shoulderTilt = viewMode === "face" ? 0 : height * 0.04;
    const hipTilt = viewMode === "face" ? 0 : height * 0.03;
    const shoulderStart = {
      x: centerX - width * 0.18,
      y: shoulderY + (ballSide === "right" ? shoulderTilt : 0),
    };
    const shoulderEnd = {
      x: centerX + width * 0.18,
      y: shoulderY + (ballSide === "left" ? shoulderTilt : 0),
    };
    const hipStart = {
      x: centerX - width * 0.15,
      y: hipY + (ballSide === "right" ? hipTilt : 0),
    };
    const hipEnd = {
      x: centerX + width * 0.15,
      y: hipY + (ballSide === "left" ? hipTilt : 0),
    };
    ctx.beginPath();
    ctx.moveTo(shoulderStart.x, shoulderStart.y);
    ctx.lineTo(shoulderEnd.x, shoulderEnd.y);
    ctx.moveTo(hipStart.x, hipStart.y);
    ctx.lineTo(hipEnd.x, hipEnd.y);
    ctx.stroke();
    drawLabel(ctx, `肩 ${lineAngleFromHorizontal(shoulderStart, shoulderEnd)}°`, centerX + width * 0.19, shoulderY + height * 0.02);
    drawLabel(ctx, `腰 ${lineAngleFromHorizontal(hipStart, hipEnd)}°`, centerX + width * 0.16, hipY + height * 0.035);
  }

  ctx.restore();
}

function lineAngleFromHorizontal(start, end) {
  return Math.round(Math.abs((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI));
}

function lineAngleFromVertical(start, end) {
  return Math.round(Math.abs((Math.atan2(end.x - start.x, end.y - start.y) * 180) / Math.PI));
}

function drawLabel(ctx, text, x, y) {
  const metrics = ctx.measureText(text);
  const paddingX = 12;
  const paddingY = 8;
  const sizeMatch = ctx.font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? Number(sizeMatch[1]) : 24;
  const height = fontSize + paddingY * 2;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(x - paddingX, y - height + paddingY, metrics.width + paddingX * 2, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawMotionTrace(ctx, width, height) {
  if (state.frames.length < 2) return;
  const recent = state.frames.slice(-45).filter((frame) => frame.energy > 4);
  if (recent.length < 2) return;

  ctx.save();
  ctx.lineWidth = Math.max(2, width * 0.004);
  ctx.strokeStyle = "rgba(65, 151, 255, 0.86)";
  ctx.beginPath();
  recent.forEach((frame, index) => {
    const x = frame.cx * width;
    const y = frame.cy * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = recent[recent.length - 1];
  ctx.fillStyle = "rgba(65, 151, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(last.cx * width, last.cy * height, Math.max(5, width * 0.009), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPoseOverlay(ctx, width, height) {
  if (!state.currentPose?.length) return;
  const pairs = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
  ];

  ctx.save();
  ctx.lineWidth = Math.max(3, width * 0.004);
  ctx.strokeStyle = "rgba(31, 220, 150, 0.92)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const [a, b] of pairs) {
    const p1 = state.currentPose[a];
    const p2 = state.currentPose[b];
    if (!isVisiblePoint(p1) || !isVisiblePoint(p2)) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x * width, p1.y * height);
    ctx.lineTo(p2.x * width, p2.y * height);
    ctx.stroke();
  }

  for (const point of state.currentPose) {
    if (!isVisiblePoint(point)) continue;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(3, width * 0.005), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function isVisiblePoint(point) {
  return point && (point.visibility == null || point.visibility > 0.45);
}

function resizeCanvasToElement(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(rect.width * ratio));
  const nextHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
}

function startAnalysisLoop() {
  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  analysisCanvas.width = 192;
  analysisCanvas.height = 108;

  function analyze() {
    if (!state.recording) return;
    if (cameraFeed.readyState >= 2) {
      captureMotionFrameFromMedia(cameraFeed, ctx, performance.now() - state.recordingStartedAt);
    }
    state.analysisRaf = requestAnimationFrame(analyze);
  }

  analyze();
}

function captureMotionFrameFromMedia(media, ctx, elapsedMs) {
  ctx.drawImage(media, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const imageData = ctx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const frame = extractMotionFrame(imageData, elapsedMs / 1000);
  if (frame) state.frames.push(frame);
}

function extractMotionFrame(imageData, timeSec) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const gray = new Uint8ClampedArray(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  if (!state.previousFrame) {
    state.previousFrame = gray;
    return null;
  }

  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  let activePixels = 0;

  for (let p = 0; p < gray.length; p += 2) {
    const diff = Math.abs(gray[p] - state.previousFrame[p]);
    if (diff > 18) {
      const x = p % width;
      const y = Math.floor(p / width);
      total += diff;
      weightedX += x * diff;
      weightedY += y * diff;
      activePixels += 1;
    }
  }

  state.previousFrame = gray;

  if (activePixels < 16) return null;
  return {
    t: timeSec,
    cx: weightedX / total / width,
    cy: weightedY / total / height,
    energy: Math.min(100, total / 12000),
  };
}

const POSE_MODEL_URLS = {
  full:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  lite:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
};

async function ensurePoseEngine() {
  if (state.poseEngine.ready || state.poseEngine.loading) return state.poseEngine.ready;
  state.poseEngine.loading = true;
  setDiagnosisMode("active", "AI姿勢推定を準備中");

  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    );

    // 精度優先で full を試し、端末が非対応/GPU不可なら lite に、
    // さらに GPU 失敗時は CPU にフォールバックして「使えない」を極力減らす。
    const attempts = [
      { model: "full", delegate: "GPU" },
      { model: "full", delegate: "CPU" },
      { model: "lite", delegate: "GPU" },
      { model: "lite", delegate: "CPU" },
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        state.poseEngine.landmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URLS[attempt.model],
            delegate: attempt.delegate,
          },
          runningMode: "VIDEO",
          numPoses: 1,
          // 検出/追跡の信頼度しきい値を明示し、低信頼の誤検出を弾いて精度を上げる
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        state.poseEngine.model = attempt.model;
        state.poseEngine.delegate = attempt.delegate;
        state.poseEngine.ready = true;
        state.poseEngine.failed = false;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!state.poseEngine.ready) throw lastError || new Error("pose engine init failed");
  } catch (error) {
    state.poseEngine.failed = true;
    state.poseEngine.ready = false;
  } finally {
    state.poseEngine.loading = false;
  }

  return state.poseEngine.ready;
}

function capturePoseFrameFromMedia(media, timeSec) {
  if (!state.poseEngine.ready || !state.poseEngine.landmarker) return null;
  try {
    const result = state.poseEngine.landmarker.detectForVideo(media, nextPoseTimestamp());
    const landmarks = result.landmarks?.[0];
    if (!landmarks?.length) return null;
    // スイング診断に使う主要関節(肩・腰・膝・足首・手首・鼻)の可視度の平均を
    // 信頼度とする。全身の単純カウントより、解析に効く点の質を反映できる。
    const keyIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    const visibilities = keyIndices
      .map((i) => landmarks[i])
      .filter(Boolean)
      .map((p) => (typeof p.visibility === "number" ? p.visibility : 1));
    const avgVisibility = visibilities.length
      ? visibilities.reduce((sum, v) => sum + v, 0) / visibilities.length
      : 0;
    const poseFrame = {
      t: timeSec,
      landmarks,
      confidence: Math.round(clamp(avgVisibility, 0, 1) * 100),
      angles: calculatePoseAngles(landmarks),
    };
    state.currentPose = landmarks;
    state.poseFrames.push(poseFrame);
    return poseFrame;
  } catch {
    return null;
  }
}

function calculatePoseAngles(landmarks) {
  const shoulder = midpoint(landmarks[11], landmarks[12]);
  const hip = midpoint(landmarks[23], landmarks[24]);
  const leftKnee = angleAt(landmarks[23], landmarks[25], landmarks[27]);
  const rightKnee = angleAt(landmarks[24], landmarks[26], landmarks[28]);
  const shoulderTilt = lineAngle(landmarks[11], landmarks[12]);
  const hipTilt = lineAngle(landmarks[23], landmarks[24]);
  const spineLean = lineAngle(hip, shoulder);

  return {
    leftKnee,
    rightKnee,
    shoulderTilt,
    hipTilt,
    spineLean,
  };
}

// 両手首が見えていれば中点、片方だけなら見えている方を使う。
// フレームごとに左右を切り替えると速度が跳ねるため、可能な限り安定した1点を返す。
function bestWristPoint(landmarks) {
  const left = landmarks[15];
  const right = landmarks[16];
  const leftOk = isVisiblePoint(left);
  const rightOk = isVisiblePoint(right);
  if (leftOk && rightOk) return midpoint(left, right);
  if (leftOk) return left;
  if (rightOk) return right;
  return null;
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: Math.min(a.visibility || 1, b.visibility || 1),
  };
}

function lineAngle(a, b) {
  if (!a || !b) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function angleAt(a, b, c) {
  if (!a || !b || !c) return 0;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!mag) return 0;
  return Math.round((Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI);
}

async function analyzePlaybackVideo() {
  if (!playback.src) return;
  await waitForVideoReady(playback);
  const poseReady = await ensurePoseEngine();

  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  analysisCanvas.width = 192;
  analysisCanvas.height = 108;
  const originalTime = playback.currentTime;
  const wasPaused = playback.paused;
  playback.pause();

  const duration = Math.min(Number.isFinite(playback.duration) ? playback.duration : 4, 60);

  // 1段階目: 全体を粗くスキャンしてスイング区間を探す
  state.frames = [];
  state.poseFrames = [];
  state.currentPose = null;
  state.previousFrame = null;
  const coarseSamples = Math.min(48, Math.max(18, Math.round(duration * 3)));
  for (let index = 0; index < coarseSamples; index += 1) {
    await seekVideo(playback, (duration * index) / Math.max(1, coarseSamples - 1));
    captureMotionFrameFromMedia(playback, ctx, playback.currentTime * 1000);
  }

  const swingWindow = detectSwingWindow(state.frames, duration);

  // 2段階目: スイング区間だけを密に解析する。
  // ダウンスイングは 0.25 秒前後で終わるため、サンプルが粗いとインパクトや
  // テンポを取りこぼす。区間長に応じて約60fps相当まで密度を上げる(上限あり)。
  state.frames = [];
  state.poseFrames = [];
  state.previousFrame = null;
  const span = Math.max(0.8, swingWindow.end - swingWindow.start);
  const denseSamples = clamp(Math.round(span * 60), 48, 130);
  for (let index = 0; index < denseSamples; index += 1) {
    const targetTime = swingWindow.start + (span * index) / Math.max(1, denseSamples - 1);
    await seekVideo(playback, targetTime);
    captureMotionFrameFromMedia(playback, ctx, playback.currentTime * 1000);
    if (poseReady) capturePoseFrameFromMedia(playback, playback.currentTime);
  }

  playback.currentTime = Math.min(originalTime, playback.duration || originalTime);
  if (!wasPaused) playback.play();
}

function detectSwingWindow(frames, duration) {
  const useful = frames.filter((frame) => frame.energy > 3);
  if (useful.length < 4) {
    return { start: 0, end: Math.min(duration, 8) };
  }

  const peak = useful.reduce(
    (best, frame) => (frame.energy > best.energy ? frame : best),
    useful[0],
  );
  const threshold = Math.max(3, peak.energy * 0.15);
  let start = peak.t;
  let end = peak.t;
  for (const frame of frames) {
    if (frame.t < start && frame.t >= peak.t - 4 && frame.energy > threshold) start = frame.t;
    if (frame.t > end && frame.t <= peak.t + 3 && frame.energy > threshold) end = frame.t;
  }

  start = Math.max(0, start - 0.6);
  end = Math.min(duration, end + 0.6);
  if (end - start < 1.2) {
    start = Math.max(0, peak.t - 1.5);
    end = Math.min(duration, peak.t + 1.2);
  }
  return { start, end };
}

function waitForVideoReady(video) {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

function seekVideo(video, time) {
  const nextTime = clamp(time, 0, Number.isFinite(video.duration) ? video.duration : time);
  if (Math.abs(video.currentTime - nextTime) < 0.002) return Promise.resolve();

  video.currentTime = nextTime;
  return new Promise((resolve) => {
    let settled = false;
    let fallback = 0;
    let retry = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      clearTimeout(retry);
      video.removeEventListener("seeked", onSeeked);
      // seeked が発火しても、実フレームがまだ描画されていないことがある。
      // requestVideoFrameCallback があれば「新しいフレームが提示された」ことを待って
      // からキャプチャすることで、シーク直後のズレたフレームを解析する事故を防ぐ。
      if (typeof video.requestVideoFrameCallback === "function") {
        let frameSettled = false;
        const done = () => {
          if (frameSettled) return;
          frameSettled = true;
          resolve();
        };
        video.requestVideoFrameCallback(() => done());
        setTimeout(done, 120);
      } else {
        resolve();
      }
    };
    const onSeeked = () => finish();
    // 低速端末でシークが完了しない場合に備えて、再指示と長めのタイムアウトを入れる
    fallback = setTimeout(finish, 1200);
    retry = setTimeout(() => {
      if (!settled && Math.abs(video.currentTime - nextTime) > 0.08) {
        video.currentTime = nextTime;
      }
    }, 500);
    video.addEventListener("seeked", onSeeked, { once: true });
  });
}

async function diagnoseSwing() {
  diagnoseBtn.disabled = true;
  resetAgents();
  setDiagnosisMode("active", "自動解析中");
  setActionHint("診断中です。少し待ってください");
  setAgent("capture", "working", "映像と撮影条件を確認中");
  adviceText.textContent = "AIエージェントがスイングを確認しています。";

  if (playback.src) {
    await analyzePlaybackVideo();
  }

  const metrics = calculateMetrics();
  setAgent("capture", "done", metrics.hasMotion ? "動き検出あり" : "動きが少なめ");
  setAgent("motion", "working", "左右ブレ、上下ブレ、テンポを確認中");

  const issues = selectedIssues();
  const result = runAgentPipeline(metrics, issues);
  renderResult(result);
  saveSession(result);

  setAgent("motion", "done", `左右ブレ:${result.swayCmLike} / テンポ:${result.tempoLabel}`);
  setAgent("coach", "done", "音声コメントを作成済み");
  setAgent("practice", "done", "次回課題を1つに整理済み");
  setDiagnosisMode(result.autoAnalyzed ? "active" : "error", result.autoAnalyzed ? "自動解析完了" : "手動ガイド中心");
  diagnoseBtn.disabled = false;
  speakAdvice();
}

function calculateMetrics() {
  const usefulFrames = state.frames.filter((frame) => frame.energy > 4);
  const poseMetrics = calculatePoseMetrics();
  const tempo = computeTempo(usefulFrames, state.poseFrames);
  if (usefulFrames.length < 8) {
    return {
      hasMotion: poseMetrics.hasPose,
      lateralRange: 0.18,
      verticalRange: 0.14,
      energyPeakAt: 0.55,
      energyBurst: 40,
      frameCount: usefulFrames.length,
      tempo,
      ...poseMetrics,
    };
  }

  const xs = usefulFrames.map((frame) => frame.cx);
  const ys = usefulFrames.map((frame) => frame.cy);
  const energies = usefulFrames.map((frame) => frame.energy);
  const peakIndex = energies.indexOf(Math.max(...energies));
  const totalDuration = usefulFrames[usefulFrames.length - 1].t - usefulFrames[0].t || 1;
  const peakAt = (usefulFrames[peakIndex].t - usefulFrames[0].t) / totalDuration;

  return {
    hasMotion: true,
    lateralRange: Math.max(...xs) - Math.min(...xs),
    verticalRange: Math.max(...ys) - Math.min(...ys),
    energyPeakAt: Math.min(1, Math.max(0, peakAt)),
    energyBurst: Math.max(...energies),
    frameCount: usefulFrames.length,
    tempo,
    ...poseMetrics,
  };
}

function computeTempo(frames, poseFrames) {
  // 姿勢推定が使えるときは手首の速度、使えないときは動きエネルギーからテンポを推定する
  let series = frames.map((frame) => ({ t: frame.t, v: frame.energy }));

  const usablePose = (poseFrames || []).filter((frame) => frame.confidence >= 45);
  if (usablePose.length >= 10) {
    const wristSeries = [];
    for (let i = 1; i < usablePose.length; i += 1) {
      const prev = usablePose[i - 1];
      const curr = usablePose[i];
      const wristPrev = bestWristPoint(prev.landmarks);
      const wristCurr = bestWristPoint(curr.landmarks);
      const dt = curr.t - prev.t;
      if (!wristPrev || !wristCurr || dt <= 0) continue;
      const speed = Math.hypot(wristCurr.x - wristPrev.x, wristCurr.y - wristPrev.y) / dt;
      wristSeries.push({ t: curr.t, v: speed });
    }
    if (wristSeries.length >= 8) series = wristSeries;
  }

  if (series.length < 8) return null;

  // 速度系列を平滑化してから始動・トップ・インパクトを検出する。
  // 生の速度はノイズで偽ピーク/偽の谷が出やすく、テンポ比が暴れる。
  const smoothedV = movingAverage(series.map((point) => point.v), 3);
  series = series.map((point, index) => ({ t: point.t, v: smoothedV[index] }));

  const peakValue = Math.max(...series.map((point) => point.v));
  if (!Number.isFinite(peakValue) || peakValue <= 0) return null;
  const impactIndex = series.findIndex((point) => point.v === peakValue);
  if (impactIndex < 3) return null;

  // 始動: インパクトから遡って動きがほぼ止まっている点
  const startThreshold = peakValue * 0.12;
  let startIndex = 0;
  for (let i = impactIndex; i >= 0; i -= 1) {
    if (series[i].v < startThreshold) {
      startIndex = i;
      break;
    }
  }

  // 切り返し(トップ): 始動〜インパクトの間で最も動きが小さい点
  let topIndex = startIndex;
  let minValue = Infinity;
  for (let i = startIndex + 1; i < impactIndex; i += 1) {
    if (series[i].v < minValue) {
      minValue = series[i].v;
      topIndex = i;
    }
  }

  const backswing = series[topIndex].t - series[startIndex].t;
  const downswing = series[impactIndex].t - series[topIndex].t;
  if (backswing <= 0.15 || downswing <= 0.05) return null;
  const ratio = backswing / downswing;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 12) return null;

  let label = "良";
  let score = 92;
  if (ratio < 2.0) {
    label = "速い";
    score = 52;
  } else if (ratio < 2.6) {
    label = "やや速い";
    score = 72;
  } else if (ratio <= 3.4) {
    label = "良";
    score = 92;
  } else {
    label = "ゆったり";
    score = 80;
  }

  return {
    ratio: Math.round(ratio * 10) / 10,
    backswing: Math.round(backswing * 100) / 100,
    downswing: Math.round(downswing * 100) / 100,
    label,
    score,
  };
}

function calculatePoseMetrics() {
  const frames = state.poseFrames.filter((frame) => frame.confidence >= 45);
  if (frames.length < 5) {
    return {
      hasPose: false,
      confidence: state.poseEngine.failed ? 35 : 52,
      headRange: null,
      hipRange: null,
      spineChange: null,
      kneeMin: null,
      bodyScale: null,
      analysisMethod: "簡易解析",
    };
  }

  // 体格スケール = 肩幅(なければ胴長)の中央値。左右ブレをこのスケールで割ることで、
  // カメラとの距離や被写体の大きさに依存しない「肩幅の何倍動いたか」に正規化する。
  const shoulderWidths = frames.map((frame) => {
    const left = frame.landmarks[11];
    const right = frame.landmarks[12];
    return left && right ? Math.hypot(left.x - right.x, left.y - right.y) : null;
  });
  const torsoLengths = frames.map((frame) => {
    const shoulderMid = midpoint(frame.landmarks[11], frame.landmarks[12]);
    const hipMid = midpoint(frame.landmarks[23], frame.landmarks[24]);
    return Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
  });
  const bodyScale = median(shoulderWidths) || median(torsoLengths) || 0.2;

  // 各系列を移動平均で平滑化してから頑健範囲を取る。
  const noseXs = movingAverage(frames.map((frame) => frame.landmarks[0]?.x), 3);
  const hipXs = movingAverage(
    frames.map((frame) => midpoint(frame.landmarks[23], frame.landmarks[24]).x),
    3,
  );
  const spineAngles = movingAverage(frames.map((frame) => frame.angles.spineLean), 3);
  const kneeSeries = movingAverage(
    frames.map((frame) => Math.min(frame.angles.leftKnee || 180, frame.angles.rightKnee || 180)),
    3,
  );

  const confidence = Math.round(
    frames.reduce((total, frame) => total + frame.confidence, 0) / frames.length,
  );

  return {
    hasPose: true,
    confidence,
    // 肩幅で正規化した値(単位: 肩幅の倍数)
    headRange: safeDivide(trimmedRange(noseXs), bodyScale),
    hipRange: safeDivide(trimmedRange(hipXs), bodyScale),
    spineChange: trimmedRange(spineAngles),
    // 単一フレームの誤検出を避けるため、最小ではなく下位5%点を採用
    kneeMin: percentile(kneeSeries, 0.05),
    bodyScale,
    analysisMethod: `AI姿勢推定${state.poseEngine.model ? `(${state.poseEngine.model})` : ""}`,
  };
}

function rangeOf(values, key) {
  const nums = values
    .map((value) => (key ? value?.[key] : value))
    .filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return Math.max(...nums) - Math.min(...nums);
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// 中心移動平均。姿勢推定の1フレームだけのブレを平滑化し、範囲や角度の暴れを抑える。
function movingAverage(values, window = 3) {
  if (window <= 1 || values.length < window) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let j = index - half; j <= index + half; j += 1) {
      if (j >= 0 && j < values.length && Number.isFinite(values[j])) {
        sum += values[j];
        count += 1;
      }
    }
    return count ? sum / count : values[index];
  });
}

function percentile(values, p) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const idx = clamp(p, 0, 1) * (nums.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

// 単純な最大-最小は外れ値1点で暴れるため、上下端を切り落とした頑健な範囲を使う。
function trimmedRange(values, lowP = 0.1, highP = 0.9) {
  const low = percentile(values, lowP);
  const high = percentile(values, highP);
  if (low == null || high == null) return null;
  return Math.max(0, high - low);
}

function safeDivide(numerator, denominator) {
  if (numerator == null || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function runAgentPipeline(metrics, issues) {
  const motion = motionAgent(metrics);
  const coach = coachAgent(motion, issues);
  const practice = practiceAgent(coach);
  return {
    ...coach,
    ...practice,
    stability: motion.stability,
    swayScore: motion.swayScore,
    swayCmLike: motion.swayCmLike,
    tempoScore: motion.tempoScore,
    tempoLabel: motion.tempoLabel,
    confidence: motion.confidence,
    analysisMethod: motion.analysisMethod,
    evidence: coach.evidence,
    quality: motion.quality,
    autoAnalyzed: metrics.hasMotion,
  };
}

function motionAgent(metrics) {
  const usePose = metrics.hasPose && metrics.headRange != null;
  // 姿勢推定時: headRange は「肩幅の倍数」(0.1〜0.6程度)。
  // 簡易解析時: lateralRange は画像内の正規化レンジ。単位が異なるため係数を分ける。
  const lateralSource = usePose ? metrics.headRange : metrics.lateralRange;
  const swayMult = usePose ? 150 : 240;
  const lateralPenaltyMult = usePose ? 60 : 190;
  const verticalPenalty = clamp(Math.round(metrics.verticalRange * 120), 0, 22);
  const lateralPenalty = clamp(Math.round(lateralSource * lateralPenaltyMult), 0, 34);
  const tempoPenalty = metrics.tempo
    ? metrics.tempo.ratio >= 2.6 && metrics.tempo.ratio <= 3.4
      ? 4
      : metrics.tempo.ratio >= 2.0 && metrics.tempo.ratio <= 4.2
        ? 10
        : 14
    : Math.abs(metrics.energyPeakAt - 0.58) > 0.22
      ? 14
      : 4;
  const posturePenalty =
    metrics.hasPose && metrics.spineChange != null ? clamp(Math.round(metrics.spineChange / 4), 0, 14) : 0;
  const stability = clamp(100 - lateralPenalty - verticalPenalty, 0, 100);
  const swayScore = clamp(Math.round(lateralSource * swayMult), 0, 100);
  const tempoScore = metrics.tempo ? metrics.tempo.score : clamp(100 - tempoPenalty * 4, 0, 100);
  const confidence = clamp(metrics.confidence || (metrics.hasMotion ? 58 : 35), 0, 100);

  return {
    lateralPenalty,
    verticalPenalty,
    tempoPenalty,
    posturePenalty,
    stability,
    swayScore,
    swayCmLike: swayScore < 32 ? "小" : swayScore < 66 ? "中" : "大",
    tempoScore,
    tempoLabel: metrics.tempo
      ? metrics.tempo.label
      : tempoScore > 80
        ? "良"
        : tempoScore > 58
          ? "やや速い"
          : "速い",
    tempo: metrics.tempo,
    hasMotion: metrics.hasMotion,
    hasPose: metrics.hasPose,
    confidence,
    analysisMethod: metrics.analysisMethod,
    quality: {
      body: metrics.hasPose ? `${confidence}%` : "未検出",
      method: metrics.analysisMethod,
      duration: playback.duration && Number.isFinite(playback.duration) ? `${playback.duration.toFixed(1)}秒` : "--",
      compare: state.sessionHistory.length ? "前回履歴あり" : "初回",
    },
    pose: {
      headRange: metrics.headRange,
      hipRange: metrics.hipRange,
      spineChange: metrics.spineChange,
      kneeMin: metrics.kneeMin,
    },
  };
}

function coachAgent(motion, issues) {
  const goal = document.querySelector("#levelSelect").value;
  const viewMode = getViewMode();
  const manualPenalty = issues.length * 7;
  const score = clamp(
    92 -
      motion.lateralPenalty -
      motion.verticalPenalty -
      motion.tempoPenalty -
      motion.posturePenalty -
      manualPenalty,
    38,
    96,
  );

  const points = [];
  const priorities = [];
  const evidence = [
    `解析方式: ${motion.analysisMethod}`,
    `信頼度: ${motion.confidence}%`,
    `左右ブレ判定: ${motion.swayCmLike}`,
    `テンポ判定: ${motion.tempoLabel}`,
  ];

  if (motion.tempo) {
    evidence.push(
      `テンポ比(バックスイング:ダウンスイング): ${motion.tempo.ratio}:1（理想は約3:1）`,
    );
  }

  if (!motion.hasMotion && !motion.hasPose) {
    points.push("自動検出が少ないため、今回は手動ガイド中心の参考診断です。次回は全身とクラブが大きく映る距離で撮影してください。");
    priorities.push("全身とクラブが入る位置にカメラを固定して再撮影");
    evidence.push("動体検出または姿勢検出が少ないため、撮影条件の影響が大きい可能性があります。");
  }
  if (motion.hasPose && motion.pose.spineChange != null) {
    evidence.push(`前傾変化の目安: ${motion.pose.spineChange.toFixed(1)}度`);
  }
  if (motion.hasPose && motion.pose.kneeMin != null) {
    evidence.push(`膝角度の最小値: ${Math.round(motion.pose.kneeMin)}度`);
  }
  if (motion.swayScore > 48 || issues.includes("sway")) {
    points.push(
      viewMode === "face"
        ? "頭と胸が右に流れやすい可能性があります。右股関節に体重を乗せても、頭は画面中央の枠内に残す意識が有効です。"
        : "後方から見ると体の中心が前後に動きやすい可能性があります。つま先側へ突っ込まず、かかと寄りの圧を残して回ってください。",
    );
    priorities.push("頭の許容ゾーンから出ない範囲でハーフスイング");
  }
  if (motion.stability < 68 || motion.posturePenalty > 8 || issues.includes("earlyExtend")) {
    points.push("インパクト付近で上体が伸びる可能性があります。骨盤の前傾を保ち、左のお尻を後ろへ引く意識を入れてください。");
    priorities.push("フィニッシュまで前傾を保つ素振りを5回");
  }
  if (motion.tempoScore < 78 || issues.includes("fastTempo")) {
    points.push("切り返しのテンポが急ぎやすい可能性があります。左足を踏んでから腕が下りる順番を作ると安定します。");
    priorities.push("トップから左足を踏むだけのゆっくり素振りを5回");
  }
  if (issues.includes("handFloat")) {
    points.push("手元が浮きやすい自己申告があります。インパクトでグリップを体から遠ざけず、左太ももの前を低く通すイメージで素振りしてください。");
    priorities.push("左太ももの前を低く通す片手素振り");
  }
  if (points.length === 0) {
    points.push("全体の動きは大きく崩れていません。次は同じテンポで、フィニッシュを2秒止められるかを確認してください。");
    priorities.push("同じテンポで3球連続フィニッシュを止める");
  }

  const goalTip = {
    stable: "まずは芯に当たる再現性を優先しましょう。",
    distance: "飛距離を狙う日は、力感よりも切り返しの順番を整える方がヘッドスピードに繋がります。",
    slice: "スライス対策では、体が開く前にクラブが下りる余裕を作ることが大切です。",
    hook: "左へのミス対策では、手で返す量を減らして胸の回転でフェースを管理しましょう。",
  }[goal];

  const summary =
    score >= 80 ? "大きな崩れは少なめ" : score >= 65 ? "改善ポイントあり" : "撮影条件と動きを再確認";
  const advice = `${points.join(" ")} ${goalTip}`;

  return {
    score,
    summary,
    advice,
    spokenAdvice: `診断結果は${score}点です。${advice}`,
    priority: priorities[0],
    evidence,
  };
}

function practiceAgent(coach) {
  const history = state.sessionHistory;
  const previous = history[0];
  const comparison = previous
    ? coach.score > previous.score
      ? `前回より${coach.score - previous.score}点改善しています。`
      : coach.score < previous.score
        ? `前回より${previous.score - coach.score}点下がっています。撮影条件も確認してください。`
        : "前回と同じスコアです。課題を1つに絞ると変化を見やすくなります。"
    : "今回が最初の記録です。次回は同じ撮影位置で比較します。";

  return {
    comparison,
    plan: [
      coach.priority,
      "同じ位置からもう一度撮影",
      "スコアよりも左右ブレとテンポの変化を見る",
    ],
  };
}

function renderResult(result) {
  stabilityMeter.value = result.stability;
  stabilityValue.textContent = `${result.stability}`;
  swayMeter.value = result.swayScore;
  swayValue.textContent = result.swayCmLike;
  tempoMeter.value = result.tempoScore;
  tempoValue.textContent = result.tempoLabel;
  confidenceMeter.value = result.confidence;
  confidenceValue.textContent = `${result.confidence}`;
  scoreValue.textContent = result.score;
  scoreNote.textContent = `${result.summary} / ${result.comparison}`;
  adviceText.textContent = result.advice;
  setActionHint("診断完了です。音声でもう一度聞けます");
  practicePlan.innerHTML = result.plan.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  evidenceList.innerHTML = result.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  qualityGrid.innerHTML = [
    `全身検出: ${result.quality.body}`,
    `解析方式: ${result.quality.method}`,
    `動画長さ: ${result.quality.duration}`,
    `比較条件: ${result.quality.compare}`,
  ]
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
  state.lastAdvice = result.spokenAdvice;
  state.lastReport = {
    createdAt: new Date().toISOString(),
    score: result.score,
    summary: result.summary,
    advice: result.advice,
    evidence: result.evidence,
    practicePlan: result.plan,
    metrics: {
      stability: result.stability,
      sway: result.swayCmLike,
      tempo: result.tempoLabel,
      confidence: result.confidence,
      analysisMethod: result.analysisMethod,
    },
  };
  speakBtn.disabled = false;
  stopSpeakBtn.disabled = false;
  exportReportBtn.disabled = false;
  copyReportBtn.disabled = false;
}

function saveSession(result) {
  const entry = {
    score: result.score,
    summary: result.summary,
    sway: result.swayCmLike,
    tempo: result.tempoLabel,
    confidence: result.confidence,
    method: result.analysisMethod,
    advice: result.advice,
    plan: result.plan,
    date: new Date().toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
  state.sessionHistory = [entry, ...state.sessionHistory].slice(0, 50);
  safeSetStorage("golfSwingVoiceCoachHistory", JSON.stringify(state.sessionHistory));
  renderHistory();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem("golfSwingVoiceCoachHistory")) || [];
  } catch {
    return [];
  }
}

function renderHistory() {
  if (!state.sessionHistory.length) {
    historyList.textContent = "まだ履歴がありません";
    return;
  }

  const visible = state.sessionHistory.slice(0, 10);
  const rest = state.sessionHistory.length - visible.length;
  historyList.innerHTML =
    visible
      .map(
        (item) =>
          `<div class="history-item">${escapeHtml(item.date)} / ${item.score}点 / 左右ブレ:${escapeHtml(
            item.sway,
          )} / テンポ:${escapeHtml(item.tempo)} / ${escapeHtml(item.method || "簡易解析")}</div>`,
      )
      .join("") +
    (rest > 0 ? `<div class="history-item">ほか${rest}件を保存中（最大50件）</div>` : "");
}

function clearHistory() {
  state.sessionHistory = [];
  safeRemoveStorage("golfSwingVoiceCoachHistory");
  renderHistory();
}

function retake() {
  stopSpeaking();
  switchToCamera();
  diagnoseBtn.disabled = true;
  retakeBtn.disabled = true;
  exportReportBtn.disabled = true;
  copyReportBtn.disabled = true;
  setDiagnosisMode("", "再撮影待ち");
  setActionHint("同じ位置で「2 録画開始」を押してください");
  adviceText.textContent = "同じ位置で再撮影してください。前回と比較しやすくなります。";
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    setStatus("error", "履歴保存不可");
  }
}

function safeRemoveStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    setStatus("error", "履歴削除不可");
  }
}

function exportReport() {
  if (!state.lastReport) return;
  const blob = new Blob([JSON.stringify(state.lastReport, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `golf-swing-report-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyReport() {
  if (!state.lastReport) return;
  const report = [
    `診断スコア: ${state.lastReport.score}`,
    `要約: ${state.lastReport.summary}`,
    `解析方式: ${state.lastReport.metrics.analysisMethod}`,
    `信頼度: ${state.lastReport.metrics.confidence}`,
    `助言: ${state.lastReport.advice}`,
    `次回課題: ${state.lastReport.practicePlan.join(" / ")}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(report);
    setStatus("ready", "レポートコピー済み");
  } catch {
    setStatus("error", "コピー不可");
  }
}

function setPlaybackRate(rate) {
  playback.playbackRate = rate;
}

function stepFrame(direction) {
  playback.pause();
  const frame = 1 / 30;
  playback.currentTime = clamp(playback.currentTime + frame * direction, 0, playback.duration || 0);
}

function speakAdvice() {
  if (!state.lastAdvice || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(state.lastAdvice);
  utterance.lang = "ja-JP";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  const voice = window.speechSynthesis
    .getVoices()
    .find((candidate) => candidate.lang.toLowerCase().startsWith("ja"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function unlockSpeech() {
  // iOS Safariは音声合成をユーザー操作起点でしか開始できないため、
  // 最初のタップ時に無音の発話を実行して以後の自動読み上げを有効にする
  if (state.speechUnlocked || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
    state.speechUnlocked = true;
  } catch {
    // 失敗しても手動の読み上げボタンは使えるため無視する
  }
}

function handleVisibility() {
  if (document.hidden) stopSpeaking();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

startCameraBtn.addEventListener("click", startCamera);
recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);
uploadVideo.addEventListener("change", handleVideoUpload);
diagnoseBtn.addEventListener("click", diagnoseSwing);
speakBtn.addEventListener("click", speakAdvice);
stopSpeakBtn.addEventListener("click", stopSpeaking);
slowBtn.addEventListener("click", () => setPlaybackRate(0.5));
normalBtn.addEventListener("click", () => setPlaybackRate(1));
backFrameBtn.addEventListener("click", () => stepFrame(-1));
nextFrameBtn.addEventListener("click", () => stepFrame(1));
clearHistoryBtn.addEventListener("click", clearHistory);
retakeBtn.addEventListener("click", retake);
exportReportBtn.addEventListener("click", exportReport);
copyReportBtn.addEventListener("click", copyReport);
cameraSelect.addEventListener("change", () => {
  if (state.stream) startCamera();
});
document.addEventListener("visibilitychange", handleVisibility);
document.addEventListener("pointerdown", unlockSpeech, { once: true });
if ("speechSynthesis" in window) {
  // 一部ブラウザでは初回のgetVoices()が空配列を返すため、事前に読み込みを促す
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    window.speechSynthesis.getVoices();
  });
}
window.addEventListener("resize", startOverlayLoop);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  installBtn.hidden = true;
});
document.querySelectorAll("input[name='viewMode'], input[name='ballSide'], .guide-toggle").forEach((input) => {
  input.addEventListener("change", startOverlayLoop);
});

if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
  setStatus("error", "録画は非対応");
  setDiagnosisMode("error", "動画読込に切替可");
  setActionHint("このブラウザでは録画できないため、「詳細操作」から動画を読み込んでください");
  adviceText.textContent =
    "このブラウザではカメラ録画が使えない可能性があります。動画読込からスイング動画を選んで診断してください。";
  startCameraBtn.disabled = true;
}

setStatus("idle");
setDiagnosisMode("", "手動ガイドのみ");
setActionHint("まず「1 カメラ開始」を押してください");
enablePlaybackTools(false);
renderHistory();
startOverlayLoop();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
