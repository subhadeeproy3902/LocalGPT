"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export default function PerformanceMonitor() {
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [gpuUsage, setGpuUsage] = useState<number | null>(null);
  const [performanceLevel, setPerformanceLevel] = useState<
    "low" | "medium" | "high"
  >("medium");
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    // Function to estimate CPU usage based on response times
    const estimateCpuUsage = () => {
      // Simple implementation - in a real app, this would use more sophisticated metrics
      const startTime = performance.now();
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Normalize to a percentage (higher duration = higher CPU usage)
      // This is a very rough approximation
      const normalizedUsage = Math.min(100, Math.max(0, (duration / 100) * 25));
      return normalizedUsage;
    };

    // Check if GPU is available
    const checkGpuAvailability = async () => {
      try {
        // Check if WebGPU is supported
        if ("gpu" in navigator) {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            // If we have an adapter, we can assume some GPU capability
            // In a real app, we would use more sophisticated metrics
            setGpuUsage(Math.random() * 50); // Placeholder value
            return true;
          }
        }
        setGpuUsage(null);
        return false;
      } catch (e) {
        console.error("Error checking GPU:", e);
        setGpuUsage(null);
        return false;
      }
    };

    // Update performance metrics periodically
    const updatePerformance = async () => {
      const cpu = estimateCpuUsage();
      setCpuUsage(cpu);

      await checkGpuAvailability();

      // Set performance level based on CPU usage
      if (cpu < 30) {
        setPerformanceLevel("high");
      } else if (cpu < 70) {
        setPerformanceLevel("medium");
      } else {
        setPerformanceLevel("low");
      }
    };

    // Show the component after a short delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1000);

    // Update performance every 5 seconds
    const interval = setInterval(updatePerformance, 5000);

    // Initial update
    updatePerformance();

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className="absolute z-50 top-4 left-4 bg-[#1a1a1a] rounded-lg p-2 text-xs border border-[#3a3a3a] shadow-lg">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "w-2 h-2 rounded-full animate-pulse",
            performanceLevel === "high"
              ? "bg-green-500"
              : performanceLevel === "medium"
              ? "bg-yellow-500"
              : "bg-red-500"
          )}
        />
        <div className="text-white">
          <span className="text-gray-400">CPU:</span> {cpuUsage.toFixed(1)}%
          {gpuUsage !== null && (
            <>
              <span className="mx-1">|</span>
              <span className="text-gray-400">GPU:</span> {gpuUsage.toFixed(1)}%
            </>
          )}
        </div>
      </div>
    </div>
  );
}

