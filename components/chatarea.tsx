"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Plus, Search, Sparkles, ImageIcon, Mic, MoreHorizontal, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import AutoResizeTextarea from "./autosize-textarea"
import { cn } from "@/lib/utils"
import { ScrollArea } from "./ui/scroll-area"
import * as webllm from "@mlc-ai/web-llm";

type Message = {
  content: string
  role: "user" | "assistant" | "system"
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [engine, setEngine] = useState<webllm.MLCEngine>()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC"
    webllm.CreateMLCEngine(selectedModel, {
      initProgressCallback: (progress) => {
        console.log("Loading model: " + progress.progress + " %" + " time: " + progress.timeElapsed + "ms");
      },
    }).then ((engine) => {
      setEngine(engine);
    });
  }, [])

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    setMessages([...messages, { content: input, role: "user" }])
    setInput("")
    const reply = await engine!.chat.completions.create({
      messages,
    })

    console.log(reply)
  }

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex flex-col justify-between h-full">
      <ScrollArea className="py-4 overflow-y-auto px-4 h-full">
        {messages.map((message, index) => (
          <div key={index} className={cn("w-fit max-w-[90%] my-4", message.role === "user" ? "place-self-end" : "self-end")}>
            {message.role === "user"&& (
              <div
                className="relative bg-[#2a2a2a] rounded-3xl px-4 py-2 text-white text-base"
              >
                {message.content}
              </div>
            )}

            {message.role === "assistant" && (
              <div className="text-white text-sm">
                <div dangerouslySetInnerHTML={{ __html: message.content.replace(/•/g, "<br/>• ") }} />
              </div>
            )}
          </div>
        ))}

        {/* {isLoading && (
          <div className="self-end max-w-[90%]">
            <div className="flex space-x-2">
              <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }}></div>
              <div
                className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                style={{ animationDelay: "150ms" }}
              ></div>
              <div
                className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                style={{ animationDelay: "300ms" }}
              ></div>
            </div>
          </div>
        )} */}
        <div ref={messagesEndRef} />
      </ScrollArea>

      <div className="p-4 sticky bottom-0">
        <div className="relative">
          <div className="rounded-3xl bg-[#2a2a2a] border border-[#3a3a3a]">
            <div className="flex items-center p-2">
              <AutoResizeTextarea
                value={input}
                onChange={(e:
                  React.ChangeEvent<HTMLTextAreaElement>
                ) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message ChatGPT..."
                maxRows={5}
                className="min-h-[24px] py-1 px-2 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-white resize-none flex-1 text-sm"
              />
            </div>

            <div className="flex items-center px-2 pb-2 gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a]"
              >
                <Plus className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                className="h-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a] px-3 text-xs flex items-center gap-1"
              >
                <Search className="h-4 w-4" />
                <span>Search</span>
              </Button>

              <Button
                variant="ghost"
                className="h-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a] px-3 text-xs flex items-center gap-1"
              >
                <Sparkles className="h-4 w-4" />
                <span>Reason</span>
              </Button>

              <Button
                variant="ghost"
                className="h-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a] px-3 text-xs flex items-center gap-1"
              >
                <ImageIcon className="h-4 w-4" />
                <span>Create image</span>
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>

              <div className="flex-1"></div>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3a3a]"
              >
                <Mic className="h-4 w-4" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-white text-black hover:bg-gray-200"
                onClick={handleSendMessage}
                disabled={!input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-500 text-center mt-2">ChatGPT can make mistakes. Check important info.</p>
        </div>
      </div>
    </div>
  )
}
