filepath = "/Users/nmantha/Desktop/GR Research/cinna-backup/frontend/app/harvest-readiness/page.tsx"
with open(filepath, "r") as f:
    content = f.read()

# 1. Update HarvestResult type
old_type = """type HarvestResult = {
  readiness_score?: number;
  readiness_status?: string;
  recommendation?: string;
  robotic_action?: string;
  quality_average?: number;
  database_saved?: boolean;
  csv_saved?: boolean;
};"""

new_type = """type HarvestResult = {
  final_score?: number;
  status?: string;
  action?: string;
  robotic_action?: string; // fallback
  status_message?: string;
  database_saved?: boolean;
  csv_saved?: boolean;
};"""

content = content.replace(old_type, new_type)

# 2. Delete the old `readiness` local state (useMemo block)
old_readiness = """  const readiness = useMemo(() => {
    if (result) {
      return {
        score:
          result.readiness_score ?? 0,
        status:
          result.readiness_status ||
          "Unknown",
        recommendation:
          result.recommendation || "",
        robotic_action:
          result.robotic_action ||
          "WAIT",
      };
    }

    return {
      score: 0,
      status: "Not Calculated",
      recommendation:
        "Please calculate harvest readiness first.",
      robotic_action: "WAIT",
    };
  }, [result]);"""

content = content.replace(old_readiness, "")

# 3. We will replace the entire grid structure starting at line 752 with a clean new structure.
# Let's find the start of the grid
grid_start_idx = content.find('<div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">')
# Let's find the end of the grid, which is right before </ProtectedRoute>
grid_end_idx = content.find("</ProtectedRoute>")

new_grid_jsx = """{result && (
  <div className="mt-8 space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Score Card */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm border-l-4 border-l-emerald-500">
        <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase">Harvest Probability</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-gray-900">{result.final_score}</span>
          <span className="text-gray-500 font-medium">%</span>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm border-l-4 border-l-blue-500">
        <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase">Status</h3>
        <div className="text-xl font-bold text-gray-900">{result.status}</div>
      </div>

      {/* Robotic Action Card */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm border-l-4 border-l-amber-500">
        <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase">Robotic Action</h3>
        <div className="text-xl font-bold text-gray-900">{result.action || result.robotic_action}</div>
      </div>
    </div>

    {/* Recommendation & Alert Section */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm border-l-4 border-l-gray-300">
        <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase">Recommendation</h3>
        <p className="text-gray-900 font-medium">{result.status_message}</p>
      </div>
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm border-l-4 border-l-red-400">
        <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase">Notice</h3>
        <p className="text-gray-900 font-medium">Verify outer bark browning before physical cut.</p>
      </div>
    </div>

    {/* Database Status Section */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">Firebase Status</h3>
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div className="text-base font-bold text-gray-900 mb-2">
          {result.database_saved ? "Saved Successfully" : "Not Saved"}
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${result.database_saved ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"}`}>
          {result.database_saved ? "Synced" : "Pending"}
        </span>
      </div>
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">CSV Dataset Status</h3>
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>
        <div className="text-base font-bold text-gray-900 mb-2">
          {result.csv_saved ? "Saved To Dataset CSV" : "Not Saved"}
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${result.csv_saved ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"}`}>
          {result.csv_saved ? "OK" : "Pending"}
        </span>
      </div>
    </div>
  </div>
)}

<div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
  <div className="space-y-6">
    <section className="card p-6">
      <h3 className="mb-5 text-base font-semibold text-slate-900">
        CDD Post-Harvest Best Practices
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          {
            icon: Scissors,
            title: "Cut Angle",
            desc: "Cut stem at a 45° angle, 1½–2 inches above ground level.",
          },
          {
            icon: Leaf,
            title: "Remove Waste",
            desc: "Remove leaves, side branches, and unripe portions before peeling.",
          },
          {
            icon: Sun,
            title: "Drying",
            desc: "Dry bark in shade for 4–7 days until moisture content drops below 14%.",
          },
          {
            icon: Package,
            title: "Expected Yield",
            desc: "Good management yields 300–450 kg/acre/year; improved varieties may reach 600 kg.",
          },
          {
            icon: RefreshCw,
            title: "Harvest Frequency",
            desc: "Two to three harvests per year are achievable with good crop management.",
          },
          {
            icon: Sprout,
            title: "First Harvest",
            desc: "The first harvest is possible 2–3 years after planting when the bark is fully mature.",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="flex gap-3 rounded-lg border border-slate-200/60 bg-white p-4"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {item.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  </div>
  
  <div className="space-y-6">
    <section className="card p-6">
      <h3 className="mb-5 text-base font-semibold text-slate-900">
        Plant Details
      </h3>
      <div className="grid grid-cols-1 gap-3">
        <InfoCard
          title="Plant ID"
          value={formData.plant_id || "-"}
        />
        <InfoCard
          title="Age"
          value={`${formData.age_months || 0} months`}
        />
        <InfoCard
          title="Rainfall Index"
          value={`${formData.rainfall_index || 0}`}
        />
        <InfoCard
          title="Outer Bark Browning"
          value={`${formData.bark_browning_percent || 0}%`}
        />
        <InfoCard
          title="Phenological Stage"
          value={String(formData.phenology_stage) === "0" ? "0 — Red Flush" : String(formData.phenology_stage) === "1" ? "1 — Flowering" : "2 — Mature"}
          green={String(formData.phenology_stage) === "2"}
        />
      </div>
    </section>
  </div>
</div>
        </div>
      </div>
    """

content = content[:grid_start_idx] + new_grid_jsx + "\n    " + content[grid_end_idx:]

with open(filepath, "w") as f:
    f.write(content)
print("Finished rewriting")
