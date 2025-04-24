"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NetworkStatus() {
  // Check if the browser is online
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="absolute z-50 top-4 right-4 bg-[#1a1a1a] rounded-lg p-2 text-xs border border-[#3a3a3a] shadow-lg">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Globe className="h-4 w-4 text-gray-400" />
          <div
            className={cn(
              "absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse",
              isOnline ? "bg-green-500" : "bg-red-500"
            )}
          />
        </div>
        <div className={cn(
          "text-xs font-medium",
          isOnline ? "text-green-400" : "text-red-400"
        )}>
          {isOnline ? "Online" : "Offline"}
        </div>
      </div>
    </div>
  );
}
