// Create a new file for centralized error logging
export type ErrorLogLevel = "info" | "warning" | "error" | "critical"

interface ErrorLogEntry {
  level: ErrorLogLevel
  message: string
  context?: Record<string, any>
  timestamp: Date
}

import NetInfo from '@react-native-community/netinfo'

class ErrorLogger {
  private logs: ErrorLogEntry[] = []
  private maxLogSize = 100 // Maximum number of logs to keep in memory
  private offlineQueue: ErrorLogEntry[] = []
  private isOnline = true

  constructor() {
    // Set up NetInfo event listener for online/offline
    NetInfo.addEventListener(state => {
      if (state.isConnected) {
        this.handleOnline()
      } else {
        this.handleOffline()
      }
    })
    // Try to load offline queue from localStorage (if available)
    this.loadOfflineQueue()
  }

  private handleOnline() {
    this.isOnline = true
    this.processOfflineQueue()
  }

  private handleOffline() {
    this.isOnline = false
  }

  private loadOfflineQueue() {
    try {
      const storedQueue = localStorage.getItem("error_log_queue")
      if (storedQueue) {
        this.offlineQueue = JSON.parse(storedQueue)
      }
    } catch (e) {
      console.error("Failed to load offline error log queue", e)
    }
  }

  private saveOfflineQueue() {
    try {
      localStorage.setItem("error_log_queue", JSON.stringify(this.offlineQueue))
    } catch (e) {
      console.error("Failed to save offline error log queue", e)
    }
  }

  private processOfflineQueue() {
    if (this.offlineQueue.length > 0 && this.isOnline) {
      // In a real app, you would send these logs to your logging service
      console.log("Processing offline error logs:", this.offlineQueue)

      // Clear the queue after processing
      this.offlineQueue = []
      this.saveOfflineQueue()
    }
  }

  log(level: ErrorLogLevel, message: string, context?: Record<string, any>) {
    const entry: ErrorLogEntry = {
      level,
      message,
      context,
      timestamp: new Date(),
    }

    // Add to in-memory logs (with size limit)
    this.logs.push(entry)
    if (this.logs.length > this.maxLogSize) {
      this.logs.shift() // Remove oldest log
    }

    // If offline, queue for later processing
    if (!this.isOnline) {
      this.offlineQueue.push(entry)
      this.saveOfflineQueue()
    }

    // Log to console
    switch (level) {
      case "info":
        console.info(`[INFO] ${message}`, context)
        break
      case "warning":
        console.warn(`[WARNING] ${message}`, context)
        break
      case "error":
      case "critical":
        console.error(`[${level.toUpperCase()}] ${message}`, context)
        break
    }

    // In a real app, you might send this to a logging service if online
  }

  info(message: string, context?: Record<string, any>) {
    this.log("info", message, context)
  }

  warning(message: string, context?: Record<string, any>) {
    this.log("warning", message, context)
  }

  error(message: string, context?: Record<string, any>) {
    this.log("error", message, context)
  }

  critical(message: string, context?: Record<string, any>) {
    this.log("critical", message, context)
  }

  getLogs() {
    return [...this.logs]
  }
}

// Create a singleton instance
export const logger = new ErrorLogger()
