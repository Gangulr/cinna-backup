"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { getAuth } from "firebase/auth";

const API_BASE = "http://127.0.0.1:8000";

const RELAY_API_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:8001"
).replace(/\/$/, "");

const emptyCoordinates = {
  startX: "-",
  startY: "-",
  endX: "-",
  endY: "-",
  confidence: "-",
  direction: "-",
  region: "-",
  bladeDepth: "-",
  barkLength: "-",
  barkWidth: "-",
  startPoint: "-",
  endPoint: "-",
  box: null,
};

const emptyPrediction = {
  displayName: "-",
  confidence: "-",
  healthStatus: "-",
  message: "Upload a cinnamon stem image to classify its health.",
};

// ---------------------------------------------------------------------------
// Measurement helpers
//
// A phone browser has no access to depth/LiDAR data (that's what makes
// iPhone's Measure app work), so this can't do true AR measurement. Instead
// it uses the standard "photo ruler" technique: the user marks a reference
// object of known real-world length in the same shot, then traces the
// outline of the thing they want measured. Because both are marked on the
// same still image, a pixels-per-mm ratio computed from the reference is
// valid for every other point in that image.
// ---------------------------------------------------------------------------

function getRenderedMediaBox(el) {
  const rect = el.getBoundingClientRect();
  const naturalW = el.naturalWidth || el.videoWidth || rect.width;
  const naturalH = el.naturalHeight || el.videoHeight || rect.height;
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH) || 1;
  const renderedW = naturalW * scale;
  const renderedH = naturalH * scale;
  const offsetX = (rect.width - renderedW) / 2;
  const offsetY = (rect.height - renderedH) / 2;
  return { naturalW, naturalH, scale, renderedW, renderedH, offsetX, offsetY };
}

// Converts a tap/click into a point in the image's natural pixel space.
// Natural pixel space stays constant regardless of on-screen zoom, which is
// what makes the calibration ratio portable to every other tap on the image.
function eventToNaturalPoint(event, el) {
  const rect = el.getBoundingClientRect();
  const box = getRenderedMediaBox(el);
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;
  const imgX = clickX - box.offsetX;
  const imgY = clickY - box.offsetY;
  if (imgX < 0 || imgY < 0 || imgX > box.renderedW || imgY > box.renderedH) {
    return null; // tapped the letterboxed padding, not the actual image
  }
  return { x: imgX / box.scale, y: imgY / box.scale };
}

function pixelDistance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Given a traced set of outline points, finds:
// - length: the greatest distance between any two points (the shape's
//   longest extent, regardless of how it's rotated in the photo)
// - width: the shape's spread perpendicular to that length axis
function computeShapeDimensions(points) {
  if (points.length < 2) return null;

  let maxDist = 0;
  let p1 = points[0];
  let p2 = points[1];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = pixelDistance(points[i], points[j]);
      if (d > maxDist) {
        maxDist = d;
        p1 = points[i];
        p2 = points[j];
      }
    }
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const axisLen = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -(dy / axisLen);
  const perpY = dx / axisLen;

  let minProj = Infinity;
  let maxProj = -Infinity;
  points.forEach((pt) => {
    const proj = (pt.x - p1.x) * perpX + (pt.y - p1.y) * perpY;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  });

  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const widthLine = [
    { x: mid.x + perpX * minProj, y: mid.y + perpY * minProj },
    { x: mid.x + perpX * maxProj, y: mid.y + perpY * maxProj },
  ];

  return {
    lengthPx: maxDist,
    widthPx: maxProj - minProj,
    lengthLine: [p1, p2],
    widthLine,
  };
}

function polygonAreaPx(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const mechanismSteps = [
  {
    number: 1,
    title: "Existing Roller & Feed Mechanism",
    shortTitle: "Roller Feed",
    status: "Constructed",
    mode: "Physical Prototype",
    description:
      "Powered rollers grip, guide and move the cinnamon stem through the processing platform.",
    action:
      "Validate stem alignment, safe forward movement and emergency-stop behaviour.",
    equipment: "Geared motor, rollers, frame, chain, copper bars and wiring",
  },
  {
    number: 2,
    title: "Adaptive Longitudinal Bark-Cutting Module",
    shortTitle: "Longitudinal Cut",
    status: "Proposed / Not Funded",
    mode: "Research Simulation",
    description:
      "Creates one controlled longitudinal incision while the floating blade head follows stem curvature.",
    action:
      "Set conservative blade depth from predicted bark thickness and monitor position and cutting force.",
    equipment: "Scoring blade, floating arm, linear rail, NEMA 17, encoder and force sensor",
  },
  {
    number: 3,
    title: "Slow-Rotation Bark-Peeling Module",
    shortTitle: "Slow-Rotation Peel",
    status: "Proposed / Not Funded",
    mode: "Research Simulation",
    description:
      "A shallow wedge blade enters the incision while separate rollers rotate and feed the stem slowly.",
    action:
      "Synchronize slow rotation with forward feed while monitoring slip, torque and peeling resistance.",
    equipment: "Peeling blade, rubber rollers, geared motor, controller, encoder and torque monitoring",
  },
];

export default function AIGuidedRoboticMachine() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const measureImgRef = useRef(null);

  const [cameraStream, setCameraStream] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [detectedImage, setDetectedImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [inputMode, setInputMode] = useState("none");
  const [detected, setDetected] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [step, setStep] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);
  const [cameraConnected, setCameraConnected] = useState(false);
  const [coordinates, setCoordinates] = useState(emptyCoordinates);
  const [prediction, setPrediction] = useState(emptyPrediction);
  const [statusMessage, setStatusMessage] = useState("Upload a cinnamon stem image to classify its health.");
  const [performance, setPerformance] = useState({
    detectionAccuracy: 0,
    peelingSuccessRate: 82,
    processingTime: 2.4,
    modelStatus: "Checking...",
  });

  // ----- ESP32 relay state -----
  const [relays, setRelays] = useState({
    r1: false,
    r2: false,
  });
  const [relayConnected, setRelayConnected] = useState(false);
  const [portConfigured, setPortConfigured] = useState(true);
  const [loadingRelay, setLoadingRelay] = useState(null);
  const [harvestLoading, setHarvestLoading] = useState(null);
  const [relayMessage, setRelayMessage] = useState("");
  const [relayError, setRelayError] = useState("");
  const [mechanismNote, setMechanismNote] = useState(
    "Complete bark detection, then start Mechanism 1."
  );

  // ----- Measurement tool state -----
  const [imgBox, setImgBox] = useState(null);
  const [measureMode, setMeasureMode] = useState("off"); // "off" | "calibrate" | "trace"
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [referenceLengthMM, setReferenceLengthMM] = useState(50);
  const [pxPerMM, setPxPerMM] = useState(null);
  const [shapePoints, setShapePoints] = useState([]);
  const [shapeClosed, setShapeClosed] = useState(false);
  const [shapeMetrics, setShapeMetrics] = useState(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const updateImgBox = useCallback(() => {
    if (measureImgRef.current) {
      setImgBox(getRenderedMediaBox(measureImgRef.current));
    }
  }, []);

  useEffect(() => {
    updateImgBox();
    window.addEventListener("resize", updateImgBox);
    window.addEventListener("orientationchange", updateImgBox);
    return () => {
      window.removeEventListener("resize", updateImgBox);
      window.removeEventListener("orientationchange", updateImgBox);
    };
  }, [updateImgBox]);

  useEffect(() => {
    const loadPerformance = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/robotic-harvesting/performance`);
        const result = await response.json();
        setPerformance({
          detectionAccuracy: result.detectionAccuracy ?? 0,
          peelingSuccessRate: result.peelingSuccessRate ?? 82,
          processingTime: result.processingTime ?? 2.4,
          modelStatus: result.modelStatus || "Unknown",
        });
      } catch (error) {
        console.error("Performance fetch error:", error);
      }
    };

    loadPerformance();
  }, []);

  // ---------------------------------------------------------------------------
  // ESP32 relay helpers
  // ---------------------------------------------------------------------------
  const getFirebaseToken = useCallback(async () => {
    const user = getAuth().currentUser;

    if (!user) {
      throw new Error("Please sign in before controlling the machine.");
    }

    return user.getIdToken();
  }, []);

  const loadRelayStatus = useCallback(async () => {
    try {
      const token = await getFirebaseToken();

      const response = await fetch(`${RELAY_API_URL}/robotic-machine/status/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Unable to retrieve the ESP32 status.");
      }

      setRelayConnected(Boolean(data.connected));
      setPortConfigured(data.serial_port_configured !== false);
      setRelays({
        r1: Boolean(data.relays?.r1),
        r2: Boolean(data.relays?.r2),
      });
      setRelayError("");
    } catch (requestError) {
      setRelayConnected(false);
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to retrieve the ESP32 status."
      );
    }
  }, [getFirebaseToken]);

  useEffect(() => {
    void loadRelayStatus();

    const statusTimer = window.setInterval(() => {
      void loadRelayStatus();
    }, 5000);

    return () => window.clearInterval(statusTimer);
  }, [loadRelayStatus]);

  const sendRelayCommand = useCallback(
    async (relay, state) => {
      const token = await getFirebaseToken();

      const response = await fetch(`${RELAY_API_URL}/robotic-machine/relay/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ relay, state }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "The relay command failed.");
      }

      setRelayConnected(Boolean(data.connected));

      if (data.relays) {
        setRelays({
          r1: Boolean(data.relays.r1),
          r2: Boolean(data.relays.r2),
        });
      }

      return data;
    },
    [getFirebaseToken]
  );

  const controlRelay = async (relay, state) => {
    try {
      setLoadingRelay(relay);
      setRelayError("");
      setRelayMessage("");

      const result = await sendRelayCommand(relay, state);

      setRelayMessage(
        `${result.command || `${relay.toUpperCase()} ${state.toUpperCase()}`} — ${
          result.esp32_response || "Command completed"
        }`
      );
    } catch (requestError) {
      setRelayConnected(false);
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "The relay command failed."
      );
    } finally {
      setLoadingRelay(null);
    }
  };

  const turnOffAllRelays = useCallback(async () => {
    const results = await Promise.allSettled([
      sendRelayCommand("r1", "off"),
      sendRelayCommand("r2", "off"),
    ]);

    const rejected = results.find((result) => result.status === "rejected");
    if (rejected && rejected.status === "rejected") {
      throw rejected.reason;
    }
  }, [sendRelayCommand]);

  const resetMeasurement = () => {
    setMeasureMode("off");
    setCalibrationPoints([]);
    setPxPerMM(null);
    setShapePoints([]);
    setShapeClosed(false);
    setShapeMetrics(null);
  };

  const resetCaptureState = () => {
    setDetected(false);
    setPrediction(emptyPrediction);
    setStatusMessage("Upload a cinnamon stem image to classify its health.");
    setConfirmed(false);
    setEmergencyStop(false);
    setStep(0);
    setMechanismNote("Complete bark detection, then start Mechanism 1.");
    setCoordinates(emptyCoordinates);
    resetMeasurement();
  };

  // Since this page runs directly in the phone's own browser, "connecting"
  // the camera is just a permission prompt — no pairing, no Bluetooth, no
  // separate device to link. facingMode: "environment" asks for the back lens.
  const connectMobileCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      setCameraStream(stream);
      setCameraConnected(true);
      setInputMode("camera");
      setPreviewImage(null);
      resetCaptureState();

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (error) {
      alert("Camera access failed. Please allow camera permission in your browser settings, or use Upload Image instead.");
      console.error(error);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setCameraStream(null);
    setCameraConnected(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL("image/png");
    setPreviewImage(imageData);
    setSelectedFile(null);
    setInputMode("captured");
    resetCaptureState();
  };

  const uploadImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file.");
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    setPreviewImage(imageUrl);
    setSelectedFile(file);
    setInputMode("upload");
    resetCaptureState();
  };

  const detectBoundary = async () => {
    if (!previewImage) return;

    try {
      setIsDetecting(true);
      setDetected(false);
      setPrediction(emptyPrediction);
      setStatusMessage("Please keep the main cinnamon stem centered in the frame.");
      setConfirmed(false);
      setEmergencyStop(false);
      setStep(0);
      setDetectedImage(null);

      let imageFile = selectedFile;
      if (!imageFile) {
        const blob = await fetch(previewImage).then((res) => res.blob());
        imageFile = new File([blob], "captured-image.png", { type: blob.type || "image/png" });
      }

      const formData = new FormData();
      formData.append("file", imageFile);

      const response = await fetch(`${API_BASE}/api/robotic-harvesting/analyze`, {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();
      let result = null;
      try {
        result = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        throw new Error(`Backend returned non-JSON response (${response.status}): ${rawText.slice(0, 120)}`);
      }

      if (response.ok && result?.status === "success") {
        const box = result.box || result.boundaryBox || result.boundingBox || null;
        if (!box || box.width == null || box.height == null) {
          setDetected(false);
          setStatusMessage("Backend did not return boundary box data.");
          return;
        }

        setCoordinates((prev) => ({
          ...prev,
          startX: result.xCoordinate ?? box.x,
          startY: result.yCoordinate ?? box.y,
          endX: box.x + box.width,
          endY: box.y + box.height,
          confidence: result.confidence ?? "-",
          direction: result.direction || result.peelDirection || "Downward",
          region: result.region || "Detected Cinnamon Bark Area",
          bladeDepth: result.bladeDepth || prev.bladeDepth,
          startPoint: result.startPoint || "Top",
          endPoint: result.endPoint || "Bottom",
          box,
        }));

        const apiPrediction = result.prediction || result.disease || {};
        setPrediction({
          displayName: apiPrediction.displayName || result.diseaseName || "Unknown",
          confidence: apiPrediction.confidence ?? "-",
          healthStatus: apiPrediction.healthStatus || result.healthStatus || "Unknown",
          message: apiPrediction.message || "Disease classification completed.",
        });
        setStatusMessage(apiPrediction.message || result.message || "Detection completed successfully.");

        setDetectedImage(result.detectedImageUrl || previewImage);
        setDetected(true);
      } else {
        setDetected(false);
        setStatusMessage(result?.message || `Detection failed (status ${response.status}).`);
      }
    } catch (error) {
      setDetected(false);
      setStatusMessage(`Cannot connect to backend. ${error.message}`);
      console.error("Detection error:", error);
    } finally {
      setIsDetecting(false);
    }
  };

  const startHarvest = async () => {
    if (!detected || emergencyStop || harvestLoading) return;

    try {
      setHarvestLoading("start");
      setRelayError("");
      setRelayMessage("");

      // Start the harvesting machine: both relays ON.
      await sendRelayCommand("r1", "on");

      try {
        await sendRelayCommand("r2", "on");
      } catch (secondRelayError) {
        // Safety rollback: if R2 fails, switch R1 back OFF.
        try {
          await sendRelayCommand("r1", "off");
        } catch (rollbackError) {
          console.error("R1 rollback failed:", rollbackError);
        }
        throw secondRelayError;
      }

      setConfirmed(true);
      setStep(1);
      setMechanismNote(
        "Mechanism 1 active: validate roller grip, stem alignment and safe feed movement."
      );
      setRelayMessage("Mechanism 1 started — R1 ON and R2 ON.");
    } catch (requestError) {
      setConfirmed(false);
      setStep(0);
      setMechanismNote("Complete bark detection, then start Mechanism 1.");
      setRelayConnected(false);
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to start harvesting."
      );
    } finally {
      setHarvestLoading(null);
    }
  };

  const stopHarvest = async () => {
    if (harvestLoading) return;

    try {
      setHarvestLoading("stop");
      setRelayError("");
      setRelayMessage("");

      // Stop the harvesting machine: both relays OFF.
      await turnOffAllRelays();
      setRelayMessage("Harvest stopped — R1 OFF and R2 OFF.");
    } catch (requestError) {
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to stop all relays."
      );
    } finally {
      setConfirmed(false);
      setStep(0);
      setMechanismNote("Complete bark detection, then start Mechanism 1.");
      setHarvestLoading(null);
      void loadRelayStatus();
    }
  };

  const emergencyStopAction = async () => {
    setEmergencyStop(true);
    setConfirmed(false);
    setStep(0);
    setMechanismNote("Emergency stop active — the full mechanism workflow is locked.");

    try {
      await turnOffAllRelays();
      setRelayMessage("Emergency stop activated — all relays OFF.");
    } catch (requestError) {
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "Emergency stop could not switch off every relay."
      );
    }
  };

  const resetEmergencyStop = () => {
    if (relays.r1 || relays.r2 || harvestLoading) return;
    setEmergencyStop(false);
    setStep(0);
    setMechanismNote("Emergency stop reset. Complete bark detection, then start Mechanism 1.");
    setRelayMessage("Emergency stop reset — machine remains OFF.");
    setRelayError("");
  };

  const advanceMechanismStep = async () => {
    if (emergencyStop || !confirmed) return;

    if (step === 1) {
      setStep(2);
      setMechanismNote(
        "Mechanism 2 research simulation: calculate a conservative longitudinal cutting depth. No cutter hardware command is sent."
      );
      return;
    }

    if (step === 2) {
      setStep(3);
      setMechanismNote(
        "Mechanism 3 research simulation: preview slow rotation and peeling synchronization. No peeler hardware command is sent."
      );
      return;
    }

    if (step === 3) {
      try {
        setHarvestLoading("complete");
        await turnOffAllRelays();
        setConfirmed(false);
        setStep(4);
        setRelayMessage("Workflow completed safely — R1 OFF and R2 OFF.");
        setMechanismNote(
          "Three-mechanism research workflow completed in the web interface. Mechanisms 2 and 3 still require fabrication and physical validation."
        );
      } catch (requestError) {
        setRelayError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to switch off the roller mechanism after completion."
        );
      } finally {
        setHarvestLoading(null);
        void loadRelayStatus();
      }
    }
  };

  const returnToPreviousMechanism = () => {
    if (step <= 1 || emergencyStop) return;
    const previousStep = step === 4 ? 3 : step - 1;
    setStep(previousStep);
    setMechanismNote(
      previousStep === 1
        ? "Mechanism 1 active: validate roller grip, stem alignment and safe feed movement."
        : previousStep === 2
        ? "Mechanism 2 research simulation: review predicted cutting depth and safety conditions."
        : "Mechanism 3 research simulation: review slow-rotation peeling settings."
    );
  };

  const resetAll = () => {
    stopCamera();
    setPreviewImage(null);
    setDetectedImage(null);
    setSelectedFile(null);
    setInputMode("none");
    resetCaptureState();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // ----- Measurement tool handlers -----
  const handleMeasureTap = (event) => {
    if (measureMode === "off" || !measureImgRef.current) return;
    event.preventDefault();
    const point = eventToNaturalPoint(event, measureImgRef.current);
    if (!point) return;

    if (measureMode === "calibrate") {
      setCalibrationPoints((prev) => {
        const next = prev.length >= 2 ? [point] : [...prev, point];
        if (next.length === 2) {
          const distPx = pixelDistance(next[0], next[1]);
          setPxPerMM(distPx > 0 && referenceLengthMM > 0 ? distPx / referenceLengthMM : null);
        } else {
          setPxPerMM(null);
        }
        return next;
      });
    } else if (measureMode === "trace") {
      if (shapeClosed) return;
      setShapePoints((prev) => [...prev, point]);
    }
  };

  const undoLastShapePoint = () => {
    setShapePoints((prev) => prev.slice(0, -1));
  };

  const clearShape = () => {
    setShapePoints([]);
    setShapeClosed(false);
    setShapeMetrics(null);
  };

  const finishShape = () => {
    if (shapePoints.length < 3 || !pxPerMM) return;
    const dims = computeShapeDimensions(shapePoints);
    const areaPx = polygonAreaPx(shapePoints);
    setShapeMetrics({
      ...dims,
      lengthMM: dims.lengthPx / pxPerMM,
      widthMM: dims.widthPx / pxPerMM,
      areaMM2: areaPx / (pxPerMM * pxPerMM),
    });
    setShapeClosed(true);
    setMeasureMode("off");
  };

  const applyShapeToParameters = () => {
    if (!shapeMetrics) return;
    setCoordinates((prev) => ({
      ...prev,
      barkLength: `${shapeMetrics.lengthMM.toFixed(1)} mm`,
      barkWidth: `${shapeMetrics.widthMM.toFixed(1)} mm`,
    }));
  };

  const healthTone =
    prediction.healthStatus === "Good"
      ? "text-green-700"
      : prediction.healthStatus === "Not Good"
      ? "text-red-700"
      : "text-gray-700";

  const measureSourceImage = previewImage; // trace against the still frame captured/uploaded

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <canvas ref={canvasRef} className="hidden" />

      <div className="mx-auto max-w-7xl">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Automated Cinnamon Bark Harvesting
          </h1>
          <p className="text-gray-600">Advanced prototype for precision harvesting and disease diagnosis</p>
        </motion.div>

        

        {/* ---------------- Three-Mechanism Sequential Workflow ---------------- */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-md"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
                Automated Cinnamon Processing Sequence
              </p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900">
                Three-Mechanism Research Workflow
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                The workflow follows the proposed physical order: feed the stem,
                create one longitudinal incision, and then separate the bark using
                slow rotation. Mechanisms 2 and 3 are interface simulations until
                fabrication, calibration and safety validation are completed.
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-bold">Research status</p>
              <p>1 constructed · 2 proposed · 3 proposed</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {mechanismSteps.map((mechanism) => {
              const isActive = step === mechanism.number;
              const isComplete = step > mechanism.number;
              const isLocked = step < mechanism.number;

              return (
                <div key={mechanism.number} className="relative">
                  <article
                    className={`h-full rounded-2xl border-2 p-5 transition-all ${
                      isActive
                        ? "border-emerald-500 bg-emerald-50 shadow-sm"
                        : isComplete
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${
                          isActive
                            ? "bg-emerald-600 text-white"
                            : isComplete
                            ? "bg-blue-600 text-white"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {isComplete ? "✓" : mechanism.number}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                          mechanism.number === 1
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {mechanism.status}
                      </span>
                    </div>

                    <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">
                      Mechanism {mechanism.number}
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-slate-900">
                      {mechanism.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {mechanism.description}
                    </p>

                    <div className="mt-4 space-y-2 rounded-xl bg-white/80 p-3 text-xs text-slate-600">
                      <p>
                        <span className="font-bold text-slate-800">Mode: </span>
                        {mechanism.mode}
                      </p>
                      <p>
                        <span className="font-bold text-slate-800">Equipment: </span>
                        {mechanism.equipment}
                      </p>
                      <p className="font-bold text-slate-800">{mechanism.budget}</p>
                    </div>

                    <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          isActive
                            ? "animate-pulse bg-emerald-500"
                            : isComplete
                            ? "bg-blue-500"
                            : "bg-slate-300"
                        }`}
                      />
                      <span
                        className={
                          isActive
                            ? "text-emerald-700"
                            : isComplete
                            ? "text-blue-700"
                            : "text-slate-500"
                        }
                      >
                        {isActive
                          ? "Current step"
                          : isComplete
                          ? "Step completed"
                          : isLocked
                          ? "Waiting for previous step"
                          : "Ready"}
                      </span>
                    </div>
                  </article>

                  {mechanism.number < 3 && (
                    <div className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-slate-800 text-xs text-white md:grid">
                      →
                    </div>
                  )}
                </div>
              );
            })}
          </div>


          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-bold text-slate-900">Safety Gate</p>
              <p className="mt-1 text-slate-600">
                Physical emergency stop must override every web command.
              </p>
            </div>
            
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-bold text-slate-900">Completion Condition</p>
              <p className="mt-1 text-slate-600">
                Fabrication, calibration and repeated real-stem testing.
              </p>
            </div>
          </div>
        </motion.section>

        {/* ---------------- ESP32 Relay Control Panel ---------------- */}
        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Robotic Machine Control
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                ESP32 USB relay controller
              </p>
            </div>

            <span
              className={`w-fit rounded-full px-3 py-1 text-sm font-medium ${
                relayConnected
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {relayConnected ? "ESP32 Connected" : "ESP32 Disconnected"}
            </span>
          </div>

          {!portConfigured && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              ESP32_SERIAL_PORT is not configured in the backend .env file.
            </div>
          )}

          {relayError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {relayError}
            </div>
          )}

          {relayMessage && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {relayMessage}
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {["r1", "r2"].map((relay) => {
              const relayNumber = relay === "r1" ? "1" : "2";
              const isOn = relays[relay];
              const isLoading = loadingRelay === relay;

              return (
                <article
                  key={relay}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        Relay {relayNumber}
                      </h3>
                      <p className="text-sm text-slate-500">
                        GPIO {relay === "r1" ? "5" : "18"}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-sm font-semibold ${
                        isOn
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isOn ? "ON" : "OFF"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={isLoading || isOn || Boolean(harvestLoading)}
                      onClick={() => void controlRelay(relay, "on")}
                      className="rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? "Sending..." : `R${relayNumber} ON`}
                    </button>

                    <button
                      type="button"
                      disabled={isLoading || !isOn || Boolean(harvestLoading)}
                      onClick={() => void controlRelay(relay, "off")}
                      className="rounded-xl bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? "Sending..." : `R${relayNumber} OFF`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="bg-white rounded-2xl p-6 shadow-md mb-8">
          

          

          {cameraConnected && <p className="text-xs text-gray-500 mb-3">Mobile camera connected — live feed below.</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border-2 border-gray-200 rounded-2xl p-4 min-h-80 flex items-center justify-center bg-gray-50">
              {inputMode === "camera" && cameraStream ? (
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain rounded-lg" />
              ) : previewImage ? (
                <img src={previewImage} alt="Preview" className="h-full w-full object-contain rounded-lg" />
              ) : (
                <div className="text-center text-gray-500">
                  <p className="text-lg">📷 Original Cinnamon Bark Image</p>
                  <p className="text-sm mt-2">Connect camera or upload image</p>
                </div>
              )}
            </div>

            <div className="border-4 border-green-500 rounded-2xl p-4 min-h-80 flex items-center justify-center bg-green-50">
              {detected && (detectedImage || previewImage) ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <img src={detectedImage || previewImage} alt="Detected" className="h-full w-full object-contain rounded-lg" />
                  {coordinates.box && !detectedImage && (
                    <div
                      className="absolute border-4 border-green-500 rounded-xl pointer-events-none"
                      style={{
                        left: `${(coordinates.box.x / 640) * 100}%`,
                        top: `${(coordinates.box.y / 420) * 100}%`,
                        width: `${(coordinates.box.width / 640) * 100}%`,
                        height: `${(coordinates.box.height / 420) * 100}%`,
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500">
                  <p className="text-lg">📊 Detected Bark Boundary</p>
                  <p className="text-sm mt-2 text-green-600">{detected ? "AI Detected" : "Waiting for detection"}</p>
                </div>
              )}
            </div>
          </div>

          <button onClick={detectBoundary} disabled={!previewImage || isDetecting} className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 transition">
            {isDetecting ? "Detecting..." : "Detect Bark Boundary"}
          </button>
        </motion.div>       
      </div>
    </div>
  );
}
