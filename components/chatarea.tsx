"use client";

import type React from "react";
import { useState, useRef, useEffect } from "react";
import { Mic, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import AutoResizeTextarea from "./autosize-textarea";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import * as webllm from "@mlc-ai/web-llm";
import { InitProgressReport, LogLevel } from "@mlc-ai/web-llm";
import ReactMarkdown from "react-markdown";
import PerformanceMonitor from "./performance-monitor";

type Message = {
  content: string;
  role: "user" | "assistant" | "system";
  timestamp?: Date; // Optional timestamp for when the message was created
};

export default function ChatInterface() {
  // Initialize messages from localStorage if available
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const savedConversation = localStorage.getItem("conversationHistory");
        if (savedConversation) {
          const parsed = JSON.parse(savedConversation);
          // Check if the saved conversation is less than 24 hours old
          const timestamp = new Date(parsed.timestamp);
          const now = new Date();
          const hoursSinceLastConversation =
            (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);

          if (
            hoursSinceLastConversation < 24 &&
            Array.isArray(parsed.messages)
          ) {
            console.log("Restored conversation from localStorage");
            return parsed.messages;
          }
        }
      } catch (e) {
        console.log("Could not restore conversation from localStorage:", e);
      }
    }
    return [
      {
        role: "system",
        content:
          "You are a helpful assistant. You provide markdown coded responses only. You are just like ChatGPT.",
        timestamp: new Date(),
      },
    ];
  });
  const [input, setInput] = useState("");
  const [engine, setEngine] = useState<webllm.MLCEngine>();
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if the browser is online
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Track if model is cached
  const [isModelCached, setIsModelCached] = useState<boolean>(false);
  const [loadingStage, setLoadingStage] = useState<string>("Checking cache...");

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

  // Check if model is cached in IndexedDB
  const checkModelCache = async (_modelId: string): Promise<boolean> => {
    console.log("Model: Checking cache for model: ", _modelId);
    try {
      // Try to open the IndexedDB database
      const dbName = "webllm-indexeddb-cache";
      const request = indexedDB.open(dbName);

      return new Promise((resolve) => {
        request.onerror = () => {
          console.log("IndexedDB access denied or not available");
          resolve(false);
        };

        request.onsuccess = () => {
          const db = request.result;
          // Check if the model store exists and has entries
          if (!db.objectStoreNames.contains("models")) {
            console.log("No models store found");
            resolve(false);
            return;
          }

          try {
            const transaction = db.transaction("models", "readonly");
            const store = transaction.objectStore("models");
            const countRequest = store.count();

            countRequest.onsuccess = () => {
              const hasEntries = countRequest.result > 0;
              console.log(
                `Model cache check: ${
                  hasEntries ? "Found cached data" : "No cached data found"
                }`
              );
              resolve(hasEntries);
            };

            countRequest.onerror = () => {
              console.log("Error checking model cache");
              resolve(false);
            };
          } catch (e) {
            console.log("Error accessing models store:", e);
            resolve(false);
          }
        };
      });
    } catch (e) {
      console.log("Error checking cache:", e);
      return false;
    }
  };

  // State for low memory mode
  const [lowMemoryMode, setLowMemoryMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("lowMemoryMode") === "true";
    }
    return false;
  });

  // Track GPU errors
  const [hadGpuError, setHadGpuError] = useState<boolean>(false);

  // Load model effect
  useEffect(() => {
    const loadModel = async () => {
      // Get the selected model
      const selectedModel = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC-1k";
      const selectedModelName = "Tiny Llama";

      setIsLoading(true);
      setHadGpuError(false);

      // Check if model is cached
      setLoadingStage(`Checking if ${selectedModelName} is cached...`);
      const isCached = await checkModelCache(selectedModel);
      setIsModelCached(isCached);

      if (isCached) {
        console.log("Model is cached, loading from cache");
        setLoadingStage("Loading model from cache...");
      } else if (!isOnline) {
        console.log("Offline and model not cached - cannot proceed");
        setLoadingStage("Error: You are offline and the model is not cached");
        setIsLoading(false);
        return;
      } else {
        console.log("Model not cached, downloading...");
        setLoadingStage(`Downloading model (~400MB required)...`);
      }

      // Configure the engine with IndexedDB caching for better offline support
      const engineConfig: webllm.MLCEngineConfig = {
        appConfig: {
          ...webllm.prebuiltAppConfig,
          useIndexedDBCache: true, // Enable IndexedDB caching for offline use
        },
        initProgressCallback: (progress: InitProgressReport) => {
          // Update loading stage based on progress text
          if (progress.text) {
            if (progress.text.includes("cache")) {
              setLoadingStage("Loading from cache...");
            } else if (progress.text.includes("download")) {
              setLoadingStage("Downloading model files...");
            } else if (progress.text.includes("initialize")) {
              setLoadingStage("Initializing model...");
            }
            console.log(progress.text);
          }

          setLoadingProgress(progress.progress);
        },
        logLevel: "INFO" as LogLevel, // Set to INFO to see more detailed logs
      };

      try {
        console.log("Creating MLCEngine for model:", selectedModel);
        const engine = await webllm.CreateMLCEngine(
          selectedModel,
          engineConfig
        );
        console.log("Model loaded successfully");
        setEngine(engine);
        setIsLoading(false);
        // Save to localStorage that we've successfully loaded this model
        localStorage.setItem("lastSuccessfulModel", selectedModel);
      } catch (error) {
        console.error("Error loading model:", error);

        // Check if this was a GPU memory error
        const errorString = String(error);
        const isGpuMemoryError =
          errorString.includes("Device was lost") ||
          errorString.includes("GPU") ||
          errorString.includes("memory") ||
          errorString.includes("DXGI_ERROR");

        if (isGpuMemoryError) {
          setHadGpuError(true);
          setLoadingStage(
            "GPU memory error detected. Try a smaller model or enable low memory mode."
          );

          if (!lowMemoryMode) {
            setLowMemoryMode(true);
            localStorage.setItem("lowMemoryMode", "true");
          }
        } else if (!isOnline) {
          setLoadingStage(
            "Error: You are offline and the model failed to load from cache"
          );
        } else {
          setLoadingStage("Failed to load model. Please try again later.");
        }

        setIsLoading(false);
      }
    };

    loadModel();
  }, [isOnline, lowMemoryMode]);

  const handleSendMessage = async () => {
    if (!input.trim() || !engine || isGenerating) return;

    const now = new Date();
    const userMessage = {
      content: input,
      role: "user" as const,
      timestamp: now
    };
    setMessages([...messages, userMessage]);
    setInput("");
    setIsGenerating(true);

    // Store messages for this conversation to avoid state update issues
    const currentMessages = [...messages, userMessage];

    try {
      // Add a temporary loading message
      setMessages((prev) => [
        ...prev,
        { content: "", role: "assistant" as const, timestamp: now },
      ]);

      // Use non-streaming for more reliable response
      const startTime = performance.now();

      // Create configuration for generation without streaming
      const generationConfig = {
        messages: currentMessages.map(({ role, content }) => ({ role, content })), // Strip timestamp for API
        stream: false, // Disable streaming for more reliable response
      };

      // Start the generation
      const response = await engine.chat.completions.create(generationConfig) as webllm.ChatCompletion;

      // Get the full response
      const fullResponse = response.choices[0].message.content || "";

      // Simulate streaming with animation in the UI
      let displayedResponse = "";
      const responseLength = fullResponse.length;
      const animationDuration = Math.min(5000, Math.max(1000, responseLength * 10)); // Between 1-5 seconds based on length
      const updateInterval = 50; // Update UI every 50ms
      const charsPerUpdate = Math.max(1, Math.ceil(responseLength / (animationDuration / updateInterval)));

      let currentIndex = 0;
      const animationInterval = setInterval(() => {
        if (currentIndex >= responseLength) {
          clearInterval(animationInterval);
          return;
        }

        const nextIndex = Math.min(responseLength, currentIndex + charsPerUpdate);
        displayedResponse = fullResponse.substring(0, nextIndex);
        currentIndex = nextIndex;

        // Update the message with the current animated response
        setMessages((prev) => [
          ...prev.slice(0, prev.length - 1),
          {
            content: displayedResponse,
            role: "assistant" as const,
            timestamp: now,
          },
        ]);

        if (currentIndex >= responseLength) {
          clearInterval(animationInterval);
        }
      }, updateInterval);

      // Final update to ensure we have the complete response (this will happen after animation completes)
      setTimeout(() => {
        setMessages((prev) => [
          ...prev.slice(0, prev.length - 1),
          {
            content: fullResponse,
            role: "assistant" as const,
            timestamp: now,
          },
        ]);
        setIsGenerating(false);
      }, animationDuration + 100);

      const endTime = performance.now();
      console.log(
        `Response generated in ${(endTime - startTime).toFixed(2)}ms`
      );

      // Cache the conversation in localStorage for quick recovery if browser refreshes
      try {
        const conversationHistory = {
          messages: [
            ...currentMessages,
            { content: fullResponse, role: "assistant" as const, timestamp: now },
          ],
          timestamp: new Date().toISOString(),
        };
        localStorage.setItem(
          "conversationHistory",
          JSON.stringify(conversationHistory)
        );
      } catch (e) {
        console.log("Could not save conversation to localStorage:", e);
      }
    } catch (error) {
      console.error("Error generating response:", error);

      // Replace the loading message with an error message
      setMessages((prev) => [
        ...prev.slice(0, prev.length - 1),
        {
          content:
            "Sorry, I encountered an error while generating a response. Please try again.",
          role: "assistant" as const,
          timestamp: new Date(),
        },
      ]);
      setIsGenerating(false);
    }
  };

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Function to clear conversation and optionally clear model cache
  const clearConversation = (clearCache = false) => {
    // Clear conversation
    setMessages([
      {
        role: "system",
        content:
          "You are a helpful assistant. You provide markdown coded responses only.",
        timestamp: new Date(),
      },
    ]);

    // Clear localStorage
    localStorage.removeItem("conversationHistory");

    // Optionally clear model cache
    if (clearCache && typeof window !== "undefined") {
      try {
        // Delete the IndexedDB database to clear model cache
        const dbName = "webllm-indexeddb-cache";
        const request = indexedDB.deleteDatabase(dbName);

        request.onsuccess = () => {
          console.log("Model cache cleared successfully");
          // Reload the page to restart the model loading process
          window.location.reload();
        };

        request.onerror = () => {
          console.error("Error clearing model cache");
        };
      } catch (e) {
        console.error("Error clearing cache:", e);
      }
    }
  };

  return (
    <div className="flex flex-col justify-between h-full">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-full">
          <div className="text-white text-xl mb-4">Loading </div>
          <div className="text-gray-400 text-sm mb-4">{loadingStage}</div>
          <div className="w-64 h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${loadingProgress * 100}%` }}
            ></div>
          </div>
          <div className="text-white mt-2">
            {(loadingProgress * 100).toFixed(2)}%
          </div>

          {!isOnline && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-md text-red-300">
              You are currently offline.{" "}
              {isModelCached
                ? "Loading model from cache..."
                : "Cannot load model without internet connection."}
            </div>
          )}

          {isModelCached && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-700 rounded-md text-green-300">
              Model found in cache. Loading locally...
            </div>
          )}

          {hadGpuError && (
            <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-md text-yellow-300">
              GPU memory error detected. Try the options below:
            </div>
          )}
        </div>
      ) : (
        <div className="relative h-full">
          <PerformanceMonitor />

          {messages.length <= 1 && engine && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-white text-xl mb-4">Your LocalGPT has been set</div>
              <div className="text-gray-400 text-sm">Start a conversation by typing a message below</div>
            </div>
          )}

          <ScrollArea className="py-4 overflow-y-auto px-4 h-full">
            {messages.length > 1 && messages.filter(m => m.role !== "system").map((message, index) => {
              // Format timestamp
              const timestamp = message.timestamp;
              let timeString = "";

              if (timestamp) {
                const now = new Date();
                const isToday = timestamp.getDate() === now.getDate() &&
                                timestamp.getMonth() === now.getMonth() &&
                                timestamp.getFullYear() === now.getFullYear();

                if (isToday) {
                  // Show only time for today's messages
                  timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } else {
                  // Show date and time for older messages
                  timeString = timestamp.toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric'
                  }) + ' ' + timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                }
              }

              return (
                <div
                  key={index}
                  className={cn(
                    "w-fit max-w-[90%] my-4",
                    message.role === "user" ? "ml-auto" : "mr-auto"
                  )}
                >
                  {message.role === "user" && (
                    <div className="flex flex-col">
                      <div className="relative bg-[#2a2a2a] rounded-3xl px-4 py-2 text-white text-base">
                        {message.content}
                      </div>
                      {timestamp && (
                        <div className="text-xs text-gray-500 mt-1 ml-2">
                          {timeString}
                        </div>
                      )}
                    </div>
                  )}

                  {message.role === "assistant" && (
                    <div className="flex flex-col">
                      <div className="bg-[#1a1a1a] rounded-3xl px-4 py-2 text-white text-sm prose prose-invert max-w-none">
                        {message.content === "" && isGenerating ? (
                          <div className="flex space-x-2 mt-2">
                            <div
                              className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"
                              style={{ animationDelay: "0ms" }}
                            ></div>
                            <div
                              className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"
                              style={{ animationDelay: "300ms" }}
                            ></div>
                            <div
                              className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"
                              style={{ animationDelay: "600ms" }}
                            ></div>
                          </div>
                        ) : (
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        )}
                      </div>
                      {timestamp && (
                        <div className="text-xs text-gray-500 mt-1 ml-2">
                          {timeString}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </ScrollArea>
        </div>
      )}

      <div className="p-4 sticky bottom-0">
        <div className="relative">
          <div className="rounded-3xl bg-[#2a2a2a] border border-[#3a3a3a]">
            <div className="flex items-center p-2">
              <AutoResizeTextarea
                value={input}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setInput(e.target.value)
                }
                onKeyDown={handleKeyDown}
                placeholder={
                  isLoading ? "Loading model..." : "Message LocalGPT..."
                }
                maxRows={5}
                disabled={isLoading || !engine}
                className="min-h-[24px] py-1 px-2 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-white resize-none flex-1 text-sm disabled:opacity-50"
              />
            </div>

            <div className="flex items-center px-2 pb-2 gap-1">
              <div className="flex-1"></div>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a]"
                disabled={isLoading || !engine}
              >
                <Mic className="h-4 w-4" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className={`h-8 w-8 rounded-full ${
                  isGenerating
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "bg-white text-black hover:bg-gray-200"
                } disabled:opacity-50 disabled:bg-gray-400`}
                onClick={handleSendMessage}
                disabled={!input.trim() || isLoading || !engine || isGenerating}
              >
                {isGenerating ? (
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-center mt-2">
            <p className="text-xs text-gray-500 text-center">
              {isLoading
                ? `Loading model...`
                : isGenerating
                ? `Generating response with model...`
                : engine
                ? `Using model (cached and ready for offline use)`
                : "Model not loaded"}
            </p>

            {!isLoading && engine && messages.length > 1 && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => clearConversation(false)}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Clear Chat
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={() => clearConversation(true)}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Clear Cache & Reload
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
