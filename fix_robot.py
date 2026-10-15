import sys

filepath = "/Users/nmantha/Desktop/GR Research/cinna-backup/frontend/app/pages/Robot.tsx"
with open(filepath, "r") as f:
    content = f.read()

# 1. Imports and constants
content = content.replace(
    'import { apiGet, apiPost } from "@/app/lib/api";',
    '''import { apiGet, apiPost } from "@/app/lib/api";
import { getAuth } from "firebase/auth";

const API_BASE = "http://127.0.0.1:8000";
const RELAY_API_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:8001"
).replace(/\\/$/, "");

const mechanismSteps = [
  {
    number: 1,
    title: "Existing Roller & Feed Mechanism",
    status: "Constructed",
    mode: "Physical Prototype",
    description: "Powered rollers grip, guide and move the cinnamon stem through the processing platform.",
    equipment: "Geared motor, rollers, frame, chain, copper bars and wiring",
  },
  {
    number: 2,
    title: "Adaptive Longitudinal Bark-Cutting Module",
    status: "Proposed / Not Funded",
    mode: "Research Simulation",
    description: "Creates one controlled longitudinal incision while the floating blade head follows stem curvature.",
    equipment: "Scoring blade, floating arm, linear rail, NEMA 17, encoder and force sensor",
  },
  {
    number: 3,
    title: "Slow-Rotation Bark-Peeling Module",
    status: "Proposed / Not Funded",
    mode: "Research Simulation",
    description: "A shallow wedge blade enters the incision while separate rollers rotate and feed the stem slowly.",
    equipment: "Peeling blade, rubber rollers, geared motor, controller, encoder and torque monitoring",
  }
];'''
)

# 2. State variables
content = content.replace(
    '  const [relayError, setRelayError] = useState("");',
    '  const [relayError, setRelayError] = useState("");\n  const [mechanismNote, setMechanismNote] = useState("Complete bark detection, then start Mechanism 1.");'
)

# 3. Functions
old_functions = """  const loadRelayStatus = useCallback(async () => {
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
  }, [sendRelayCommand]);"""

new_functions = """  const getFirebaseToken = useCallback(async () => {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Please sign in before controlling the machine.");
    return user.getIdToken();
  }, []);

  const loadRelayStatus = useCallback(async () => {
    try {
      const token = await getFirebaseToken();
      const response = await fetch(`${RELAY_API_URL}/robotic-machine/status/`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Unable to retrieve the ESP32 status.");
      setRelayConnected(Boolean(data.connected));
      setPortConfigured(data.serial_port_configured !== false);
      setRelays({ r1: Boolean(data.relays?.r1), r2: Boolean(data.relays?.r2) });
      setRelayError("");
    } catch (requestError) {
      setRelayConnected(false);
      setRelayError(requestError instanceof Error ? requestError.message : "Unable to retrieve status.");
    }
  }, [getFirebaseToken]);

  useEffect(() => {
    void loadRelayStatus();
    const statusTimer = window.setInterval(() => { void loadRelayStatus(); }, 5000);
    return () => window.clearInterval(statusTimer);
  }, [loadRelayStatus]);

  const sendRelayCommand = useCallback(async (relay: RelayName, state: RelaySwitchState) => {
    const token = await getFirebaseToken();
    const response = await fetch(`${RELAY_API_URL}/robotic-machine/relay/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ relay, state }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.detail || "The relay command failed.");
    setRelayConnected(Boolean(data.connected));
    if (data.relays) setRelays({ r1: Boolean(data.relays.r1), r2: Boolean(data.relays.r2) });
    return data;
  }, [getFirebaseToken]);

  const controlRelay = async (relay: RelayName, state: RelaySwitchState) => {
    try {
      setLoadingRelay(relay);
      setRelayError("");
      setRelayMessage("");
      const result = await sendRelayCommand(relay, state);
      setRelayMessage(`${result.command || `${relay.toUpperCase()} ${state.toUpperCase()}`} — ${result.esp32_response || "Command completed"}`);
    } catch (requestError) {
      setRelayConnected(false);
      setRelayError(requestError instanceof Error ? requestError.message : "The relay command failed.");
    } finally {
      setLoadingRelay(null);
    }
  };

  const turnOffAllRelays = useCallback(async () => {
    const results = await Promise.allSettled([sendRelayCommand("r1", "off"), sendRelayCommand("r2", "off")]);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected && rejected.status === "rejected") throw rejected.reason;
  }, [sendRelayCommand]);"""

content = content.replace(old_functions, new_functions)

# 4. UI Block
old_ui = """        {/* ESP32 Relay Control Panel */}
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
        </motion.section>"""

new_ui = """        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Automated Cinnamon Processing Sequence</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900">Three-Mechanism Research Workflow</h2>
            </div>
          </div>
        </motion.section>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Robotic Machine Control</h2>
              <p className="mt-1 text-sm text-slate-500">ESP32 USB relay controller</p>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-sm font-medium ${relayConnected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {relayConnected ? "ESP32 Connected" : "ESP32 Disconnected"}
            </span>
          </div>

          {relayError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{relayError}</div>}
          {relayMessage && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{relayMessage}</div>}

          <div className="grid gap-5 md:grid-cols-2">
            {(["r1", "r2"] as RelayName[]).map((relay) => {
              const relayNumber = relay === "r1" ? "1" : "2";
              const isOn = relays[relay];
              const isLoading = loadingRelay === relay;

              return (
                <article key={relay} className="rounded-2xl border border-slate-200 p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">Relay {relayNumber}</h3>
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${isOn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {isOn ? "ON" : "OFF"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" disabled={isLoading || isOn} onClick={() => void controlRelay(relay, "on")} className="rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {isLoading ? "Sending..." : `R${relayNumber} ON`}
                    </button>
                    <button type="button" disabled={isLoading || !isOn} onClick={() => void controlRelay(relay, "off")} className="rounded-xl bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {isLoading ? "Sending..." : `R${relayNumber} OFF`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>"""

content = content.replace(old_ui, new_ui)

with open(filepath, "w") as f:
    f.write(content)

print("Replacement complete.")
