"use client"

import React, { useRef, useEffect } from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxRows?: number
}

const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ className, maxRows = 10, onChange, ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const combinedRef = (node: HTMLTextAreaElement) => {
      textareaRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    }

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current
      if (textarea) {
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = "auto"

        // Calculate the new height
        const lineHeight = Number.parseInt(getComputedStyle(textarea).lineHeight)
        const paddingTop = Number.parseInt(getComputedStyle(textarea).paddingTop)
        const paddingBottom = Number.parseInt(getComputedStyle(textarea).paddingBottom)
        const maxHeight = lineHeight * maxRows + paddingTop + paddingBottom

        // Set the new height
        const newHeight = Math.min(textarea.scrollHeight, maxHeight)
        textarea.style.height = `${newHeight}px`
      }

      // Call the original onChange handler
      onChange?.(e)
    }

    // Initialize height on mount and when value changes
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        // Trigger resize on initial render
        textarea.style.height = "auto"
        textarea.style.height = `${Math.min(
          textarea.scrollHeight,
          Number.parseInt(getComputedStyle(textarea).lineHeight) * maxRows +
            Number.parseInt(getComputedStyle(textarea).paddingTop) +
            Number.parseInt(getComputedStyle(textarea).paddingBottom),
        )}px`
      }
    }, [props.value, maxRows])

    return (
      <Textarea
        ref={combinedRef}
        onChange={handleChange}
        className={cn("resize-none overflow-hidden", className)}
        {...props}
      />
    )
  },
)

AutoResizeTextarea.displayName = "AutoResizeTextarea"

export default AutoResizeTextarea
