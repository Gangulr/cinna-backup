"use client";

import { useEffect, useState } from "react";

export default function DiseaseChart() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch("http://localhost:8001/disease-history")
      .then((res) => res.json())
      .then((resData) => {
        console.log("API RESPONSE:", resData);

        // ✅ FIX: ensure array
        const list = Array.isArray(resData)
          ? resData
          : resData.history || resData.data || [];

        const counts: any = {};

        list.forEach((item: any) => {
          const key = item.prediction || "Unknown";
          counts[key] = (counts[key] || 0) + 1;
        });

        const chartData = Object.keys(counts).map((key) => ({
          name: key,
          value: counts[key],
        }));

        setData(chartData);
      })
      .catch((err) => console.log("Error fetching history:", err));
  }, []);

  return (
    <div className="rounded-3xl border bg-white p-6 shadow">
      <h3 className="mb-4 text-xl font-semibold">
        Distribution of Detected Diseases
      </h3>

      {data.length === 0 ? (
        <p>No data available</p>
      ) : (
        data.map((item, i) => (
          <div key={i} className="mb-3">
            <div className="flex justify-between text-sm">
              <span>{item.name}</span>
              <span>{item.value}</span>
            </div>

            <div className="w-full bg-gray-200 h-3 rounded">
              <div
                className="bg-green-500 h-3 rounded"
                style={{ width: `${item.value * 20}%` }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}