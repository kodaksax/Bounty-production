// Create a new file for centralized error logging
import AsyncStorage from '@react-native-async-storage/async-storage';

import NetInfo from '@react-native-community/netinfo';
export type ErrorLogLevel = "info" | "warning" | "error" | "critical"
interface ErrorLogEntry {
  level: ErrorLogLevel
  message: string
  context?: Record<string, any>
  timestamp: Date
}

class ErrorLogger {
  private logs: ErrorLogEntry[] = []
  private maxLogSize = 100 // Maximum number of logs to keep in memory
  private offlineQueue: ErrorLogEntry[] = []
  private isOnline = true

  constructor() {
    // Set up NetInfo listener and load AsyncStorage queue if available.
    // Wrap in try/catch because this module may be imported in non-RN envs
    // (e.g., node scripts) where these native modules aren't present.
    try {
      if (NetInfo && typeof NetInfo.addEventListener === 'function') {
        NetInfo.addEventListener(state => {
          try {
            if (state && state.isConnected) {
              this.handleOnline()
            } else {
              this.handleOffline()
            }
          } catch (inner) {
            // avoid throwing during event handling
            console.error('[ErrorLogger] NetInfo handler error', inner)
          }
        })
      }
    } catch (_e) {
      // NetInfo isn't available in this runtime; continue without online/offline tracking
      console.error('[ErrorLogger] NetInfo not available, skipping network listener')
      this.isOnline = true
    }

    // Try to load offline queue from AsyncStorage (if available)
    try {
      this.loadOfflineQueue()
    } catch (e) {
      console.error('[ErrorLogger] AsyncStorage not available, skipping offline queue load')
    }
  }

  private handleOnline() {
    this.isOnline = true
    this.processOfflineQueue()
  }

  private handleOffline() {
    this.isOnline = false
  }

  private async loadOfflineQueue() {
  try {
    const storedQueue = await AsyncStorage.getItem("error_log_queue")
    if (storedQueue) {
      this.offlineQueue = JSON.parse(storedQueue)
    }
  } catch (e) {
    console.error("Failed to load offline error log queue", e)
  }
}

  private async saveOfflineQueue() {
    try {
      await AsyncStorage.setItem("error_log_queue", JSON.stringify(this.offlineQueue))
    } catch (e) {
      console.error("Failed to save offline error log queue", e)
    }
  }

  private processOfflineQueue() {
    if (this.offlineQueue.length > 0 && this.isOnline) {
      // In a real app, you would send these logs to your logging service
      // Use console.log for processing messages to ensure output appears in
      // Metro/terminal logs (console.info can be filtered in some setups).

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

    // Normalize any Error objects in context so React Native developer overlay
    // and remote logging capture the message and stack (some Error properties
    // are non-enumerable and show up as {}). Replace Error instances with
    // plain objects containing name/message/stack.
    const normalizedContext = (() => {
      if (!context) return context
      const out: Record<string, any> = {}
      for (const k of Object.keys(context)) {
        const v = (context as any)[k]
        if (v instanceof Error) {
          out[k] = { name: v.name, message: v.message, stack: v.stack }
        } else if (v && typeof v === 'object') {
          // If nested object contains an Error under `error` key, extract it
          if ('error' in v && v.error instanceof Error) {
            out[k] = { ...v, error: { name: v.error.name, message: v.error.message, stack: v.error.stack } }
          } else {
            out[k] = v
          }
        } else {
          out[k] = v
        }
      }
      return out
    })()

    // Log to console with normalized context so it's useful in RN overlay and logs
    switch (level) {
      case "info":
        // console.info is not always visible in some Metro/Terminal setups,
        // so also use console.log which is more reliable across environments.
        console.log(`[INFO] ${message}`, normalizedContext)
        break
      case "warning":
        console.warn(`[WARNING] ${message}`, normalizedContext)
        break
      case "error":
      case "critical":
        console.error(`[${level.toUpperCase()}] ${message}`, normalizedContext)
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
