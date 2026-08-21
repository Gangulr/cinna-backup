import { useEffect, useState } from "react";
import { getSensors } from "../services/sensorService";

type SensorRow = {
  temperature: number;
  humidity: number;
  soil_moisture: number;
};

function Dashboard() {
  const [data, setData] = useState<SensorRow[]>([]);

  useEffect(() => {
    getSensors().then((res: { data: SensorRow[] }) => setData(res.data));
  }, []);

  return (
    <div>
      <h2>Sensor Data</h2>
      {data.map((d, i) => (
        <p key={i}>
          {d.temperature}°C | {d.humidity}% | {d.soil_moisture}
        </p>
      ))}
    </div>
  );
}

export default Dashboard;