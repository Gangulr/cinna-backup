import Link from "next/link";
import {
  ArrowRight,
  LayoutDashboard,
  Microscope,
  Radio,
  TrendingUp,
  Leaf,
} from "lucide-react";

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      {/* Atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16, 185, 129, 0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(6, 95, 70, 0.06), transparent), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23047857' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      {/* Hero */}
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-1.5 text-xs font-medium text-emerald-800">
            <Leaf className="h-3.5 w-3.5" />
            Smart Agri-Tech Platform
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
            CinnaAI
          </h1>

          <p className="mt-4 max-w-xl text-lg font-medium text-slate-700 sm:text-xl">
            Smart Cinnamon Monitoring System
          </p>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            AI and IoT for growth prediction, disease detection, and harvest
            optimization — built for production estates.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/dashboard" className="btn-primary px-6 py-3">
              Open Dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/diseaseprediction" className="btn-secondary px-6 py-3">
              Run Disease Scan
            </Link>
          </div>
        </div>

        {/* Feature strip — below fold on most viewports, secondary to hero */}
        <div className="mt-20 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              href: "/dashboard",
              icon: LayoutDashboard,
              title: "Analytics Overview",
              desc: "Live KPIs and prediction summaries",
            },
            {
              href: "/iot-monitoring",
              icon: Radio,
              title: "IoT Telemetry",
              desc: "Real-time sensor gauges",
            },
            {
              href: "/diseaseprediction",
              icon: Microscope,
              title: "Disease Detection",
              desc: "Vision-based leaf & bark analysis",
            },
            {
              href: "/growthprediction",
              icon: TrendingUp,
              title: "Growth Models",
              desc: "ML-backed harvest forecasts",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group card p-5 transition-all duration-200 hover:border-emerald-200 hover:shadow-md"
              >
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-100">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {item.title}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {item.desc}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
