"use client";

import { useEffect, useState } from "react";
import { Globe, WifiOff, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NetworkStatus() {
  // Check if the browser is online
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Track connection quality
  const [connectionQuality, setConnectionQuality] = useState<string>("unknown");

  // Track if PWA is installed
  const [isPWAInstalled, setIsPWAInstalled] = useState<boolean>(false);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // When coming back online, check connection quality
      checkConnectionQuality();
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check if app is installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsPWAInstalled(true);
    }

    // Initial connection quality check
    checkConnectionQuality();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Function to check connection quality
  const checkConnectionQuality = () => {
    if (!navigator.onLine) {
      setConnectionQuality("offline");
      return;
    }

    // Use the Network Information API if available
    if ('connection' in navigator && (navigator as any).connection) {
      const connection = (navigator as any).connection;

      if (connection.saveData) {
        setConnectionQuality("low"); // Data saver is on
      } else if (connection.effectiveType) {
        // 'slow-2g', '2g', '3g', or '4g'
        setConnectionQuality(connection.effectiveType);
      }

      // Listen for connection changes
      connection.addEventListener('change', checkConnectionQuality);
    } else {
      // Fallback if Network Information API is not available
      setConnectionQuality(isOnline ? "unknown" : "offline");
    }
  };

  // Get appropriate icon and color based on connection status
  const getConnectionInfo = () => {
    if (!isOnline) {
      return {
        icon: <WifiOff className="h-4 w-4 text-red-400" />,
        dotColor: "bg-red-500",
        textColor: "text-red-400",
        text: "Offline"
      };
    }

    // Online with different connection qualities
    switch(connectionQuality) {
      case "slow-2g":
      case "2g":
        return {
          icon: <Wifi className="h-4 w-4 text-yellow-400" />,
          dotColor: "bg-yellow-500",
          textColor: "text-yellow-400",
          text: "Slow"
        };
      case "3g":
        return {
          icon: <Wifi className="h-4 w-4 text-blue-400" />,
          dotColor: "bg-blue-500",
          textColor: "text-blue-400",
          text: "Good"
        };
      case "4g":
      default:
        return {
          icon: <Wifi className="h-4 w-4 text-green-400" />,
          dotColor: "bg-green-500",
          textColor: "text-green-400",
          text: "Online"
        };
    }
  };

  const connectionInfo = getConnectionInfo();

  return (
    <div className="absolute z-50 top-4 right-4 bg-[#1a1a1a] rounded-lg p-2 text-xs border border-[#3a3a3a] shadow-lg">
      <div className="flex items-center gap-2">
        <div className="relative">
          {connectionInfo.icon}
          <div
            className={cn(
              "absolute -top-1 -right-1 w-2 h-2 rounded-full animate-pulse",
              connectionInfo.dotColor
            )}
          />
        </div>
        <div className={cn(
          "text-xs font-medium",
          connectionInfo.textColor
        )}>
          {connectionInfo.text}
          {isPWAInstalled && <span className="ml-1 text-gray-400">(PWA)</span>}
        </div>
      </div>
    </div>
  );
}
