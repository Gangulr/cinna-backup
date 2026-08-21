"use client";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AIGuidedRoboticMachine from "../pages/Robot";

export default function RoboticHarvestingPage() {
  return (
    <ProtectedRoute>
      <AIGuidedRoboticMachine />
    </ProtectedRoute>
  );
}
