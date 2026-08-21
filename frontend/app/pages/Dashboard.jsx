// app/dashboard/page.tsx
import StatCard from "../../components/StatCard";

export default function Dashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">📊 Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Temperature" value="30°C" />
        <StatCard title="Humidity" value="75%" />
        <StatCard title="Soil Moisture" value="60%" />
      </div>
    </div>
  );
}