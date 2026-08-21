"use client";

import React, { useState } from "react";

const DiseasePredictor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setResult(null);
    }
  };

  const predict = async () => {
    if (!file) return alert("Upload image first");

    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8001/predict", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      console.log("API RESPONSE:", data);

      setResult(data);
    } catch (err) {
      console.log(err);
      alert("Backend error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">

      <div className="w-full max-w-3xl bg-white p-6 rounded-xl shadow">

        <h1 className="text-2xl font-bold text-green-700 text-center mb-4">
          🌿 Cinnamon Disease Detection AI
        </h1>

        {/* Upload */}
        <input
          type="file"
          onChange={onFileChange}
          className="mb-4 w-full"
        />

        {/* Preview */}
        {preview && (
          <img
            src={preview}
            className="w-40 h-40 mx-auto mb-4 rounded border"
          />
        )}

        {/* Button */}
        <button
          onClick={predict}
          disabled={loading}
          className="w-full bg-green-600 text-white py-3 rounded hover:bg-green-700"
        >
          {loading ? "Analyzing..." : "Predict Disease"}
        </button>

        {/* RESULT */}
        {result && (
          <div className="mt-6 space-y-4">

            {/* ⭐ MAIN AI OUTPUT (BEST DISPLAY) */}
            {result?.formatted_output && (
              <div className="p-5 bg-gray-900 text-green-300 rounded-xl whitespace-pre-wrap shadow-lg">
                {result.formatted_output}
              </div>
            )}

            {/* Prediction Card */}
            <div className="p-4 bg-green-100 rounded">
              <h2 className="font-bold text-lg">
                {result?.prediction}
              </h2>
              <p>Confidence: {result?.confidence}</p>
            </div>

            {/* Diagnosis */}
            <div className="p-4 bg-blue-50 rounded">
              <p className="font-bold">🔍 Diagnosis</p>
              <p>{result?.diagnosis}</p>
            </div>

            {/* Symptoms */}
            <div className="p-4 bg-gray-50 rounded">
              <p className="font-bold">⚠️ Symptoms</p>
              <p>{result?.symptoms}</p>
            </div>

            {/* Solutions */}
            <div className="p-4 bg-red-50 rounded">
              <p className="font-bold">💡 Solutions</p>

              <ul className="list-disc ml-5">
                {result?.solutions?.map((item: string, i: number) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default DiseasePredictor;