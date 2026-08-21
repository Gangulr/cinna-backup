// app/page.tsx
export default function Home() {
    return (
      <div className="flex flex-col items-center justify-center mt-24 text-center">
        <h1 className="text-5xl font-bold mb-4 text-green-700">
          🌿 AI Cinnamon Monitoring System
        </h1>

        <p className="text-gray-600 max-w-xl">
          AI + IoT powered smart agriculture system for predicting growth,
          detecting diseases, and optimizing harvest time.
        </p>

        <div className="mt-8 space-x-4">
          <a href="/dashboard" className="bg-green-500 text-white px-6 py-3 rounded-xl shadow hover:bg-green-600">
            View Dashboard
          </a>

          <a href="/prediction" className="bg-white border px-6 py-3 rounded-xl shadow hover:bg-gray-100">
            AI Prediction
          </a>
        </div>
      </div>
    );
  }
