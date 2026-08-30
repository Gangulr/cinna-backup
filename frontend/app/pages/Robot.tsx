import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { apiGet, apiPost } from "@/app/lib/api";
import {
  Camera,
  ScanSearch,
  MapPin,
  Settings2,
  Scissors,
  Package,
  Play,
  Square,
  AlertOctagon,
  Upload,
  Video,
  VideoOff,
  Aperture,
  Eye,
  CheckCircle2,
  Timer,
  RotateCcw,
  SlidersHorizontal,
  FlaskConical,
  Loader2,
} from "lucide-react";

type RelayName = "r1" | "r2";
type RelaySwitchState = "on" | "off";
type HarvestAction = "start" | "stop";

type RelayStates = Record<RelayName, boolean>;

interface RelayStatusResponse {
  connected: boolean;
  serial_port_configured?: boolean;
  relays?: Partial<RelayStates>;
}

interface RelayCommandResponse extends RelayStatusResponse {
  success: boolean;
  command?: string;
  esp32_response?: string;
}

const RELAY_NAMES: RelayName[] = ["r1", "r2"];

export default function AIGuidedRoboticMachine() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState("none");
  const [detected, setDetected] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [step, setStep] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [relays, setRelays] = useState<RelayStates>({
    r1: false,
    r2: false,
  });
  const [relayConnected, setRelayConnected] = useState(false);
  const [portConfigured, setPortConfigured] = useState(true);
  const [loadingRelay, setLoadingRelay] = useState<RelayName | null>(null);
  const [harvestLoading, setHarvestLoading] = useState<HarvestAction | null>(null);
  const [relayMessage, setRelayMessage] = useState("");
  const [relayError, setRelayError] = useState("");

  const coordinates = useMemo(
    () => ({
      startX: 245,
      startY: 180,
      endX: 245,
      endY: 420,
      confidence: 88,
      direction: "Downward",
      region: "Central Cinnamon Bark Area",
      bladeDepth: "12 mm",
      startPoint: "Top",
      endPoint: "Bottom",
    }),
    []
  );

  const movementSteps = [
    { name: "Image Capture", icon: Camera },
    { name: "Bark Detection", icon: ScanSearch },
    { name: "Coordinate Generation", icon: MapPin },
    { name: "Blade Alignment", icon: Settings2 },
    { name: "Peeling", icon: Scissors },
    { name: "Peel Outlet", icon: Package },
  ];

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    const getAvailableCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");
        setAvailableCameras(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedCameraId(videoDevices[0].deviceId);
        }
      } catch (error) {
        console.error("Error enumerating devices:", error);
      }
    };

    getAvailableCameras();
  }, []);

  const loadRelayStatus = useCallback(async () => {
    try {
      const data = await apiGet<RelayStatusResponse>(
        "/robotic-machine/status/"
      );

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
  }, []);

  useEffect(() => {
    void loadRelayStatus();

    const statusTimer = window.setInterval(() => {
      void loadRelayStatus();
    }, 5000);

    return () => window.clearInterval(statusTimer);
  }, [loadRelayStatus]);

  const sendRelayCommand = useCallback(
    async (relay: RelayName, state: RelaySwitchState) => {
      const data = await apiPost<RelayCommandResponse>(
        "/robotic-machine/relay/",
        { relay, state }
      );

      setRelayConnected(Boolean(data.connected));

      if (data.relays) {
        setRelays({
          r1: Boolean(data.relays.r1),
          r2: Boolean(data.relays.r2),
        });
      }

      return data;
    },
    []
  );

  const controlRelay = async (
    relay: RelayName,
    state: RelaySwitchState
  ) => {
    try {
      setLoadingRelay(relay);
      setRelayError("");
      setRelayMessage("");

      const result = await sendRelayCommand(relay, state);
      const command =
        result.command || `${relay.toUpperCase()} ${state.toUpperCase()}`;

      setRelayMessage(
        `${command} — ${result.esp32_response || "Command completed"}`
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
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    if (rejected) {
      throw rejected.reason;
    }
  }, [sendRelayCommand]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
        audio: false,
      });

      setCameraStream(stream);
      setInputMode("camera");
      setPreviewImage(null);
      setDetected(false);
      setConfirmed(false);
      setEmergencyStop(false);
      setStep(0);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (error) {
      alert("Camera access failed. Please allow camera permission or use image upload.");
      console.error(error);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    }
    setCameraStream(null);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL("image/png");
    setPreviewImage(imageData);
    setSelectedFile(null);
    setInputMode("captured");
    setDetected(false);
    setConfirmed(false);
    setEmergencyStop(false);
    setStep(0);
  };

  const uploadImage = (event: React.ChangeEvent<HTMLInputElement>) => {
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
    setDetected(false);
    setConfirmed(false);
    setEmergencyStop(false);
    setStep(0);
  };

  const detectBoundary = async () => {
    if (!previewImage) return;

    try {
      setIsDetecting(true);
      setDetected(false);
      setConfirmed(false);
      setEmergencyStop(false);
      setStep(0);

      let imageFile = selectedFile;
      if (!imageFile) {
        const blob = await fetch(previewImage).then((res) => res.blob());
        imageFile = new File([blob], "captured-image.png", { type: blob.type || "image/png" });
      }

      const formData = new FormData();
      formData.append("file", imageFile);

      const response = await fetch("http://127.0.0.1:8000/api/robotic-harvesting/analyze", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (response.ok && result.status === "success") {
        setDetected(true);
      } else {
        setDetected(false);
        alert(result.message || "Detection failed. Only cinnamon images are allowed.");
      }
    } catch (error) {
      setDetected(false);
      alert("Cannot connect to backend. Make sure FastAPI server is running on port 8000.");
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

      await sendRelayCommand("r1", "on");

      try {
        await sendRelayCommand("r2", "on");
      } catch (secondRelayError) {
        try {
          await sendRelayCommand("r1", "off");
        } catch (rollbackError) {
          console.error("R1 rollback failed:", rollbackError);
        }
        throw secondRelayError;
      }

      setConfirmed(true);
      setStep(1);
      setRelayMessage("Harvest started — R1 ON and R2 ON.");
    } catch (requestError) {
      setConfirmed(false);
      setStep(0);
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
      setHarvestLoading(null);
      void loadRelayStatus();
    }
  };

  const emergencyStopAction = async () => {
    setEmergencyStop(true);
    setConfirmed(false);
    setStep(0);

    try {
      setRelayError("");
      setRelayMessage("");
      await turnOffAllRelays();
      setRelayMessage("Emergency stop activated — all relays OFF.");
    } catch (requestError) {
      setRelayError(
        requestError instanceof Error
          ? requestError.message
          : "Emergency stop could not switch off every relay."
      );
    } finally {
      void loadRelayStatus();
    }
  };

  const resetAll = () => {
    stopCamera();
    setPreviewImage(null);
    setSelectedFile(null);
    setInputMode("none");
    setDetected(false);
    setConfirmed(false);
    setEmergencyStop(false);
    setStep(0);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <canvas ref={canvasRef} className="hidden" />

      <div className="page-shell">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="page-title">
            AI-Guided Robotic Harvesting
          </h1>
          <p className="page-subtitle">
            Precision bark detection and automated peeling control for cinnamon harvesting.
          </p>
        </motion.div>

        {/* Status row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
        >
          {/* Dark camera feed wrapper */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-md">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">
                Robotic Machine Status
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Feed Live
              </span>
            </div>
            <div className="flex min-h-72 items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 p-6">
              <div className="text-center">
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-xl border border-slate-700 bg-slate-800 text-slate-400">
                  <Video className="h-7 w-7" />
                </div>
                <p className="text-sm font-medium text-slate-300">
                  Robotic Machine Camera Feed
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Preview / telemetry channel
                </p>
              </div>
            </div>
          </div>

          {/* System Status */}
          <div className="card space-y-3 p-6">
            <h2 className="text-base font-semibold text-slate-900">System Status</h2>

            <div className="rounded-lg border border-slate-200/60 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="kpi-label">Bark Boundary</p>
                <span className={detected ? "badge-healthy" : "badge-info"}>
                  {detected ? "Detected" : "Pending"}
                </span>
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">
                {detected ? "Detected" : "Detecting…"}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200/60 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="kpi-label">Machine Status</p>
                <span className={relayConnected ? "badge-healthy" : "badge-danger"}>
                  {relayConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">
                {confirmed ? "Harvesting" : "Ready"}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200/60 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="kpi-label">Safety Status</p>
                <span className={emergencyStop ? "badge-danger" : "badge-healthy"}>
                  {emergencyStop ? "Stopped" : "Active"}
                </span>
              </div>
              <p
                className={`mt-2 text-lg font-bold ${
                  emergencyStop ? "text-rose-700" : "text-slate-900"
                }`}
              >
                {emergencyStop ? "Emergency Stop" : "Active"}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Control Buttons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex flex-wrap gap-3"
        >
          <button
            onClick={() => void startHarvest()}
            disabled={
              !detected ||
              emergencyStop ||
              confirmed ||
              Boolean(harvestLoading)
            }
            className="btn-primary"
          >
            {harvestLoading === "start" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {harvestLoading === "start" ? "Starting…" : "Start Harvest"}
          </button>

          <button
            onClick={() => void stopHarvest()}
            disabled={
              (!confirmed && !relays.r1 && !relays.r2) ||
              Boolean(harvestLoading)
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-amber-600 hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
          >
            {harvestLoading === "stop" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {harvestLoading === "stop" ? "Stopping…" : "Stop"}
          </button>

          <button
            onClick={() => void emergencyStopAction()}
            disabled={emergencyStop}
            className="btn-danger"
          >
            <AlertOctagon className="h-4 w-4" /> Emergency Stop
          </button>
        </motion.div>

        {/* ESP32 Relay Control Panel */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12 }}
          className="card p-6"
        >
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Robotic Machine Control
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                ESP32 USB relay controller
              </p>
            </div>

            <span className={relayConnected ? "badge-healthy" : "badge-danger"}>
              {relayConnected ? "ESP32 Connected" : "ESP32 Disconnected"}
            </span>
          </div>

          {!portConfigured && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              ESP32_SERIAL_PORT is not configured in the backend environment.
            </div>
          )}

          {relayError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {relayError}
            </div>
          )}

          {relayMessage && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {relayMessage}
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {RELAY_NAMES.map((relay) => {
              const relayNumber = relay === "r1" ? "1" : "2";
              const isOn = relays[relay];
              const isLoading = loadingRelay === relay;

              return (
                <article
                  key={relay}
                  className="rounded-xl border border-slate-200/60 bg-white p-5"
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

                    <span className={isOn ? "badge-healthy" : "badge-info"}>
                      {isOn ? "ON" : "OFF"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={
                        isLoading || isOn || Boolean(harvestLoading)
                      }
                      onClick={() => void controlRelay(relay, "on")}
                      className="btn-primary px-4 py-3"
                    >
                      {isLoading ? "Sending…" : `R${relayNumber} ON`}
                    </button>

                    <button
                      type="button"
                      disabled={
                        isLoading || !isOn || Boolean(harvestLoading)
                      }
                      onClick={() => void controlRelay(relay, "off")}
                      className="btn-danger px-4 py-3"
                    >
                      {isLoading ? "Sending…" : `R${relayNumber} OFF`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </motion.section>

        {/* Camera Input Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="card p-6"
        >
          <h2 className="mb-4 text-base font-semibold text-slate-900">
            Vision Input
          </h2>

          <div className="mb-5 flex flex-wrap gap-3">
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              disabled={cameraStream !== null}
              className="input-field max-w-xs"
            >
              <option value="" disabled>
                Select Camera
              </option>
              {availableCameras.length > 0 ? (
                availableCameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))
              ) : (
                <option disabled>No cameras found</option>
              )}
            </select>

            <button
              onClick={startCamera}
              disabled={cameraStream !== null}
              className="btn-secondary"
            >
              <Video className="h-4 w-4" /> Start Camera
            </button>

            <button
              onClick={captureFrame}
              disabled={!cameraStream}
              className="btn-secondary"
            >
              <Aperture className="h-4 w-4" /> Capture Frame
            </button>

            <button
              onClick={stopCamera}
              disabled={!cameraStream}
              className="btn-secondary"
            >
              <VideoOff className="h-4 w-4" /> Stop Camera
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary"
            >
              <Upload className="h-4 w-4" /> Upload Image
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={uploadImage}
              className="hidden"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Dark feed for live / preview */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
              <div className="border-b border-slate-800 px-4 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Source Preview
                </p>
              </div>
              <div className="flex min-h-80 items-center justify-center p-4">
                {inputMode === "camera" && cameraStream ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full max-h-72 w-full rounded-lg object-contain"
                  />
                ) : previewImage ? (
                  <img
                    src={previewImage}
                    alt="Preview"
                    className="h-full max-h-72 w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="text-center text-slate-500">
                    <Camera className="mx-auto mb-3 h-10 w-10 opacity-40" />
                    <p className="text-sm font-medium text-slate-400">
                      Original Cinnamon Bark Image
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Start camera or upload image
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200/60 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Detected Boundary
                </p>
                {detected && <span className="badge-healthy">AI Detected</span>}
              </div>
              <div className="flex min-h-80 items-center justify-center p-4">
                {detected && previewImage ? (
                  <div className="relative flex h-full w-full items-center justify-center">
                    <img
                      src={previewImage}
                      alt="Detected"
                      className="h-full max-h-72 w-full rounded-lg object-contain opacity-70"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-2/3 w-3/4 rounded-xl border-2 border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]" />
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-slate-400">
                    <ScanSearch className="mx-auto mb-3 h-10 w-10 opacity-50" />
                    <p className="text-sm font-medium text-slate-600">
                      Detected Bark Boundary
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {detected ? "AI Detected" : "Waiting for detection"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={detectBoundary}
            disabled={!previewImage || isDetecting}
            className="btn-primary mt-5 w-full py-3"
          >
            {isDetecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Detecting…
              </>
            ) : (
              <>
                <ScanSearch className="h-4 w-4" /> Detect Bark Boundary
              </>
            )}
          </button>
        </motion.div>

        {/* Coordinates */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="card p-6"
        >
          <h2 className="mb-5 text-base font-semibold text-slate-900">
            Generated Coordinates & Parameters
          </h2>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "X Coordinate", value: detected ? coordinates.startX : "-" },
              { label: "Y Coordinate", value: detected ? coordinates.startY : "-" },
              { label: "Start Point", value: detected ? coordinates.startPoint : "-" },
              { label: "End Point", value: detected ? coordinates.endPoint : "-" },
              { label: "Peel Direction", value: detected ? coordinates.direction : "-" },
              { label: "Blade Depth", value: detected ? coordinates.bladeDepth : "-" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-200/60 bg-white p-4 text-center"
              >
                <p className="kpi-label mb-2">{item.label}</p>
                <p className="text-xl font-bold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Movement Flow Pipeline */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="card p-6"
        >
          <h2 className="mb-6 text-base font-semibold text-slate-900">
            Robotic Machine Movement Flow
          </h2>

          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
            {movementSteps.map((s, index) => {
              const Icon = s.icon;
              const active = confirmed && step > 0 && index < step + 2;
              return (
                <React.Fragment key={index}>
                  <div className="flex shrink-0 flex-col items-center text-center">
                    <div
                      className={[
                        "mb-2 flex h-14 w-14 items-center justify-center rounded-xl border transition-all duration-300",
                        active
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-white text-slate-500",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="max-w-[88px] text-xs font-semibold text-slate-700">
                      {s.name}
                    </p>
                  </div>
                  {index < movementSteps.length - 1 && (
                    <div
                      className={[
                        "mx-1 hidden h-0.5 flex-1 rounded-full md:block",
                        active ? "bg-emerald-400" : "bg-slate-200",
                      ].join(" ")}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </motion.div>

        {/* System Performance */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="card p-6"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              System Performance
            </h2>
            <span className="badge-healthy">Test Run Completed</span>
          </div>
          <p className="mb-6 text-sm text-slate-600">
            Evaluation results of AI bark detection and robotic peeling process
          </p>

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200/60 bg-white p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <Eye className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium text-slate-600">AI Vision</p>
              </div>
              <p className="kpi-label">Detection Accuracy</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">88%</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-emerald-600" style={{ width: "88%" }} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/60 bg-white p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium text-slate-600">Robotic Peeling</p>
              </div>
              <p className="kpi-label">Peeling Success Rate</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">82%</p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-emerald-600" style={{ width: "82%" }} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/60 bg-white p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
                  <Timer className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium text-slate-600">Processing Speed</p>
              </div>
              <p className="kpi-label">Processing Time</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">2.4s</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Average time for image analysis, coordinate generation, and action preparation.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              Manual Override & Advanced Controls
            </h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={resetAll} className="btn-secondary">
                <RotateCcw className="h-4 w-4" /> Manual Override
              </button>
              <button
                onClick={() => alert("Adjust Parameters - Feature Coming Soon")}
                className="btn-secondary"
              >
                <SlidersHorizontal className="h-4 w-4" /> Adjust Parameters
              </button>
              <button
                onClick={() => alert("Test Run - Starting automated test sequence")}
                className="btn-primary"
              >
                <FlaskConical className="h-4 w-4" /> Test Run
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
