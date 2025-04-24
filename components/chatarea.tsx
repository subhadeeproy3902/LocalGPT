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
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark as dark } from "react-syntax-highlighter/dist/esm/styles/prism";
import PerformanceMonitor from "./performance-monitor";
import NetworkStatus from "./network-status";
import remarkGfm from "remark-gfm";
import Markdown from "react-markdown";
import { modelId, modelName } from "@/constant/modelConfig";

interface CodeBlockProps {
  language: string;
  value: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, value }) => {
  return (
    <div style={{ position: "relative", marginBottom: "1rem" }}>
      <SyntaxHighlighter language={language} style={dark}>
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

type Message = {
  content: string;
  role: "user" | "assistant" | "system";
  timestamp?: Date; // Optional timestamp for when the message was created
};

export default function ChatInterface() {
  // Initialize history from localStorage if available - this stores the full conversation
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
            // Convert string timestamps back to Date objects
            const messagesWithProperDates = parsed.messages.map(
              (msg: {
                content: string;
                role: "user" | "assistant" | "system";
                timestamp?: string;
              }) => ({
                ...msg,
                timestamp: msg.timestamp ? new Date(msg.timestamp) : undefined,
              })
            );
            return messagesWithProperDates;
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
          "You are a helpful assistant. You provide answers only in Markdown format",
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
          // Check if the model store exists
          if (!db.objectStoreNames.contains("models")) {
            console.log("No models store found");
            resolve(false);
            return;
          }

          try {
            const transaction = db.transaction("models", "readonly");
            const store = transaction.objectStore("models");

            // First check if there are any entries at all
            const countRequest = store.count();

            countRequest.onsuccess = () => {
              const hasEntries = countRequest.result > 0;

              if (!hasEntries) {
                console.log("Model cache check: No cached data found");
                resolve(false);
                return;
              }

              // If there are entries, check specifically for model files
              // This is a more thorough check to ensure the model is fully cached
              const modelKeyRange = IDBKeyRange.bound(
                [_modelId, ""],
                [_modelId, "\uffff"]
              );

              const modelFilesRequest = store.getAll(modelKeyRange);

              modelFilesRequest.onsuccess = () => {
                const modelFiles = modelFilesRequest.result;
                const isModelCached = modelFiles.length > 0;

                console.log(
                  `Model cache check for ${_modelId}: ${
                    isModelCached
                      ? `Found ${modelFiles.length} cached model files`
                      : "No model files found"
                  }`
                );

                resolve(isModelCached);
              };

              modelFilesRequest.onerror = () => {
                console.log("Error checking specific model files in cache");
                // Fall back to the general check result
                resolve(hasEntries);
              };
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

  // Preload model check - run this early to speed up model loading
  useEffect(() => {
    const preloadModelCheck = async () => {
      if (typeof window !== "undefined") {
        // Get the selected model
        const selectedModel = modelId;

        // Check if model is cached early
        const isCached = await checkModelCache(selectedModel);
        setIsModelCached(isCached);

        // Check when the model was last successfully loaded
        const lastLoadedTime = localStorage.getItem("modelLastLoadedTime");
        let isRecentlyLoaded = false;

        if (lastLoadedTime) {
          try {
            const lastLoaded = new Date(lastLoadedTime);
            const now = new Date();
            // If model was loaded in the last 7 days, consider it valid
            const daysSinceLastLoad =
              (now.getTime() - lastLoaded.getTime()) / (1000 * 60 * 60 * 24);
            isRecentlyLoaded = daysSinceLastLoad < 7;

            if (isRecentlyLoaded && !isCached) {
              console.log(
                "Model was recently loaded but not detected in cache - may be a cache detection issue"
              );
              // If model was recently loaded but not detected in cache, we'll still try to load it
              setIsModelCached(true);
            }
          } catch (e) {
            console.error("Error parsing last loaded time:", e);
          }
        }

        // If model is cached or was recently loaded, prepare IndexedDB for faster access
        if (isCached || isRecentlyLoaded) {
          try {
            // Open the database to warm up the cache
            const dbName = "webllm-indexeddb-cache";
            const request = indexedDB.open(dbName);
            request.onsuccess = () => {
              console.log("IndexedDB cache warmed up for faster model loading");

              // If we're offline, pre-check if we can access the database properly
              if (!isOnline) {
                try {
                  const db = request.result;
                  if (db.objectStoreNames.contains("models")) {
                    console.log(
                      "IndexedDB cache verified and accessible while offline"
                    );
                  }
                } catch (e) {
                  console.error("Error accessing IndexedDB while offline:", e);
                }
              }
            };
          } catch (e) {
            console.error("Error warming up IndexedDB cache:", e);
          }
        }
      }
    };

    preloadModelCheck();
  }, [isOnline]);

  // Load model effect
  useEffect(() => {
    const loadModel = async () => {
      // Get the selected model - using a smaller quantized model for faster loading
      const selectedModel = modelId;
      const selectedModelName = modelName;

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
        console.log(
          "Offline and model not detected in cache - attempting to load anyway"
        );
        setLoadingStage("Offline - attempting to load model from cache...");
        // We'll still try to load the model even if our cache check didn't detect it
        // This provides a fallback in case our cache detection isn't perfect
      } else {
        console.log("Model not cached, downloading...");
        setLoadingStage(`Downloading model (~900MB required)...`);
      }

      // Configure the engine with enhanced IndexedDB caching for better offline support
      // Use type assertion to add performance optimizations
      const engineConfig = {
        appConfig: {
          ...webllm.prebuiltAppConfig,
          useIndexedDBCache: true, // Enable IndexedDB caching for offline use
          cacheConfig: {
            // Enhanced cache configuration
            persistentStorage: true, // Use persistent storage when available
            cacheTimeout: 3600000, // Longer cache timeout (1 hour)
            prioritizeCachedData: true, // Always try to use cached data first
            maxCacheSize: 2000 * 1024 * 1024, // Allow up to 2GB cache size
          },
          // Force offline mode if we're offline to prevent network requests
          forceOfflineMode: !isOnline,
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
        // Add retry options for better reliability
        retryOptions: {
          maxRetries: 3,
          retryDelay: 1000,
          retryOnNetworkError: true,
        },
      };

      try {
        console.log("Creating MLCEngine for model:", selectedModel);

        // Add performance measurement for model loading
        const modelLoadStartTime = performance.now();

        // Create the engine with optimized config
        const engine = await webllm.CreateMLCEngine(
          selectedModel,
          engineConfig as webllm.MLCEngineConfig
        );

        const modelLoadEndTime = performance.now();
        const loadTimeMs = modelLoadEndTime - modelLoadStartTime;
        console.log(`Model loaded successfully in ${loadTimeMs.toFixed(2)}ms`);

        // Engine is now ready for inference

        // Warm up the model with a simple inference to improve first response time
        try {
          console.log("Warming up model with test inference...");
          await engine.chat.completions.create({
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 1,
          });
          console.log("Model warm-up complete");
        } catch (warmupError) {
          console.warn("Model warm-up failed, but continuing:", warmupError);
        }

        setEngine(engine);
        setIsLoading(false);

        // Update model cache status since we successfully loaded it
        setIsModelCached(true);

        // Save to localStorage that we've successfully loaded this model
        localStorage.setItem("lastSuccessfulModel", selectedModel);

        // Store a timestamp of when the model was last successfully loaded
        // This helps with cache validation in future sessions
        localStorage.setItem("modelLastLoadedTime", new Date().toISOString());
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
          // More detailed error message for offline mode
          console.error("Offline mode error details:", error);

          // Check if this might be a cache-related error
          const errorString = String(error);
          const isCacheError =
            errorString.includes("cache") ||
            errorString.includes("storage") ||
            errorString.includes("IndexedDB") ||
            errorString.includes("QuotaExceededError");

          if (isCacheError) {
            setLoadingStage(
              "Error: Cache access issue. Try clearing browser data and reloading."
            );
          } else {
            setLoadingStage(
              "Error: You are offline and the model failed to load from cache. " +
                "Please connect to the internet to download the model first."
            );
          }

          // Set isModelCached to false since we couldn't load it
          setIsModelCached(false);
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
      timestamp: now,
    };

    // Add user message to the full conversation history
    setMessages([...messages, userMessage]);
    setInput("");
    setIsGenerating(true);

    // We'll create a message array with just the current user query and a minimal system message
    // This prevents context window size issues by not sending any conversation history

    try {
      // Add a temporary loading message to the UI
      setMessages((prev) => [
        ...prev,
        { content: "", role: "assistant" as const, timestamp: now },
      ]);

      // Use non-streaming for more reliable response
      const startTime = performance.now();

      // Create configuration for generation without streaming
      // Only send the current user query to the LLM with a minimal system message
      // Use a custom interface to allow additional properties
      interface CustomGenerationConfig
        extends webllm.ChatCompletionRequestBase {
        context_window_size?: number;
        sliding_window_size?: number;
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
        batch_size?: number;
      }

      // Optimize inference settings for faster response
      const generationConfig: CustomGenerationConfig = {
        messages: [
          {
            role: "user",
            content: userMessage.content,
          },
        ],
        stream: false,
        // Optimize context window for faster inference
        context_window_size: 1024, // Reduced from 2048 for faster processing
        sliding_window_size: 512, // Reduced from 1024 for faster processing
        // Limit token generation for faster responses
        max_tokens: 1024,
        // Optimize sampling parameters
        temperature: 1,
        top_p: 1,
        // Add batch processing for faster inference
        batch_size: 8,
        // Reduce repetition penalties for faster processing
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
      };

      const response = (await engine.chat.completions.create(
        generationConfig
      )) as webllm.ChatCompletion;

      // Get the full response
      const fullResponse = response.choices[0].message.content || "";

      // Optimize the animation for faster perceived response
      // Use a more efficient approach with fewer state updates
      let displayedResponse = "";
      const responseLength = fullResponse.length;

      // Faster animation for shorter responses
      const animationDuration = Math.min(
        2000, // Maximum 2 seconds (reduced from 5)
        Math.max(500, responseLength * 5) // Minimum 500ms, 5ms per character (reduced from 10)
      );

      // Reduce UI updates for better performance
      const updateInterval = 100; // Update UI less frequently (increased from 50ms)
      const charsPerUpdate = Math.max(
        5, // Show at least 5 characters per update (increased from 1)
        Math.ceil(responseLength / (animationDuration / updateInterval))
      );

      // Use requestAnimationFrame for smoother animation
      let currentIndex = 0;
      let lastUpdateTime = performance.now();

      const updateAnimation = () => {
        const now = performance.now();
        const deltaTime = now - lastUpdateTime;

        if (deltaTime >= updateInterval) {
          if (currentIndex >= responseLength) {
            // Animation complete
            setMessages((prev) => [
              ...prev.slice(0, prev.length - 1),
              {
                content: fullResponse,
                role: "assistant" as const,
                timestamp: new Date(),
              },
            ]);
            setIsGenerating(false);
            return;
          }

          // Calculate next chunk to display
          const nextIndex = Math.min(
            responseLength,
            currentIndex + charsPerUpdate
          );
          displayedResponse = fullResponse.substring(0, nextIndex);
          currentIndex = nextIndex;

          // Update the message with the current animated response
          // Use functional update to avoid stale state
          setMessages((prev) => [
            ...prev.slice(0, prev.length - 1),
            {
              content: displayedResponse,
              role: "assistant" as const,
              timestamp: new Date(),
            },
          ]);

          lastUpdateTime = now;
        }

        // Continue animation if not complete
        if (currentIndex < responseLength) {
          requestAnimationFrame(updateAnimation);
        } else {
          setIsGenerating(false);
        }
      };

      // Start the animation
      requestAnimationFrame(updateAnimation);

      const endTime = performance.now();
      console.log(
        `Response generated in ${(endTime - startTime).toFixed(2)}ms`
      );

      // Cache the conversation in localStorage for quick recovery if browser refreshes
      try {
        // Get the updated messages array with the assistant's response
        const updatedMessages = [
          ...messages.slice(0, messages.length - 1), // Remove the temporary loading message
          {
            content: fullResponse,
            role: "assistant" as const,
            timestamp: now,
          },
        ];

        const conversationHistory = {
          messages: updatedMessages,
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
    // Create a new system prompt
    const systemPrompt = {
      role: "system" as const,
      content:
        "You are a helpful assistant. You provide answers only in Markdown format",
      timestamp: new Date(),
    };

    // Clear conversation history
    setMessages([systemPrompt]);

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
          <NetworkStatus />
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
                : "Cannot download model without internet connection."}
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
      ) : !engine && !isOnline ? (
        <div className="relative h-full">
          <PerformanceMonitor />
          <NetworkStatus />

          <div className="flex flex-col items-center justify-center h-full">
            <div className="text-white text-xl mb-4">Your LocalGPT</div>
            <div className="text-gray-400 text-sm mb-4">
              Interface loaded from cache
            </div>

            <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-md text-red-300 max-w-md text-center">
              <p className="font-semibold mb-2">You are currently offline</p>
              {!isModelCached ? (
                <>
                  <p className="mb-2">
                    The model is not detected in the cache on this device.
                  </p>
                  <p className="mb-2">
                    Connect to the internet to download the model for offline
                    use.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-2 px-4 py-2 bg-red-800 hover:bg-red-700 rounded-md text-white text-sm"
                  >
                    Try Again
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-2">
                    The model is cached but failed to load. This could be due
                    to:
                  </p>
                  <ul className="text-left list-disc pl-5 mb-2">
                    <li>Incomplete model download</li>
                    <li>Cache corruption</li>
                    <li>Browser storage limitations</li>
                  </ul>
                  <div className="flex gap-2 justify-center mt-3">
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3 py-1 bg-red-800 hover:bg-red-700 rounded-md text-white text-sm"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => clearConversation(true)}
                      className="px-3 py-1 bg-red-800 hover:bg-red-700 rounded-md text-white text-sm"
                    >
                      Clear Cache & Reload
                    </button>
                  </div>
                </>
              )}
            </div>

            {messages.length > 1 && (
              <div className="mt-6">
                <div className="text-gray-400 text-sm mb-2">
                  Your conversation history is available:
                </div>
                <ScrollArea className="py-4 flex flex-col overflow-y-auto px-4 h-[300px] max-w-md">
                  {messages
                    .filter((m) => m.role !== "system")
                    .map((message, index) => {
                      // Format timestamp for display
                      let timeString = "";
                      const timestamp = message.timestamp;

                      if (
                        timestamp &&
                        timestamp instanceof Date &&
                        !isNaN(timestamp.getTime())
                      ) {
                        timeString = timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                      } else if (timestamp) {
                        try {
                          const dateObj = new Date(timestamp);
                          if (!isNaN(dateObj.getTime())) {
                            timeString = dateObj.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            });
                          }
                        } catch (e) {
                          console.log("Error formatting timestamp:", e);
                        }
                      }

                      return (
                        <div
                          key={index}
                          className="my-2 p-2 bg-[#1a1a1a] rounded-md"
                        >
                          <div className="flex justify-between items-center mb-1">
                            <div className="text-xs text-gray-500">
                              {message.role === "user" ? "You" : "Assistant"}
                            </div>
                            {timeString && (
                              <div className="text-xs text-gray-600">
                                {timeString}
                              </div>
                            )}
                          </div>
                          <div
                            className={`text-sm ${
                              message.role === "user"
                                ? "text-white"
                                : "text-gray-300"
                            }`}
                          >
                            {message.content}
                          </div>
                        </div>
                      );
                    })}
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <PerformanceMonitor />
          <NetworkStatus />

          {messages.length <= 1 && engine && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="text-white text-xl mb-4">
                Your LocalGPT has been set
              </div>
              <div className="text-gray-400 text-sm">
                Start a conversation by typing a message below
              </div>
            </div>
          )}

          <ScrollArea className="mt-12 flex flex-col py-4 overflow-y-auto px-4 h-full">
            {messages.length > 1 &&
              messages
                .filter((m) => m.role !== "system")
                .map((message, index) => {
                  // Format timestamp
                  const timestamp = message.timestamp;
                  let timeString = "";

                  if (
                    timestamp &&
                    timestamp instanceof Date &&
                    !isNaN(timestamp.getTime())
                  ) {
                    // Ensure timestamp is a valid Date object
                    const now = new Date();
                    const isToday =
                      timestamp.getDate() === now.getDate() &&
                      timestamp.getMonth() === now.getMonth() &&
                      timestamp.getFullYear() === now.getFullYear();

                    if (isToday) {
                      // Show only time for today's messages
                      timeString = timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                    } else {
                      // Show date and time for older messages
                      timeString =
                        timestamp.toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        }) +
                        " " +
                        timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                    }
                  } else if (timestamp) {
                    // If timestamp exists but isn't a valid Date, try to convert it
                    try {
                      const dateObj = new Date(timestamp);
                      if (!isNaN(dateObj.getTime())) {
                        timeString = dateObj.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                      }
                    } catch (e) {
                      console.log("Error formatting timestamp:", e);
                    }
                  }

                  return (
                    <div
                      key={index}
                      className={cn(
                        "my-4",
                        message.role === "user"
                          ? "ml-auto w-fit max-w-[90%]"
                          : "w-full mr-auto"
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
                          <div className="bg-[#1a1a1a] w-fit rounded-3xl px-4 py-2 text-white text-sm prose prose-invert max-w-none">
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
                              <div className="markdown-body">
                                <Markdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    code({ className, children, ...props }) {
                                      const match = /language-(\w+)/.exec(
                                        className || ""
                                      );
                                      return match ? (
                                        <CodeBlock
                                          language={match[1]}
                                          value={String(children).replace(
                                            /\n$/,
                                            ""
                                          )}
                                        />
                                      ) : (
                                        <code className={className} {...props}>
                                          {children}
                                        </code>
                                      );
                                    },
                                  }}
                                >
                                  {message.content}
                                </Markdown>
                              </div>
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
        </>
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
                  isLoading
                    ? "Loading model..."
                    : !engine && !isOnline && !isModelCached
                    ? "Offline - model not available"
                    : "Message LocalGPT..."
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
                ? `Using model (${
                    isModelCached
                      ? "cached and ready for offline use"
                      : "online mode"
                  })`
                : !isOnline
                ? isModelCached
                  ? `Offline mode - model cached but failed to load`
                  : `Offline mode - model not available`
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
