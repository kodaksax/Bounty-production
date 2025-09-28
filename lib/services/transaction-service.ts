import type { Transaction } from "app/tabs/transaction-history-screen"
import { logger } from "lib/utils/error-logger"

/**
 * Service for handling transaction data
 */
export const transactionService = {
  /**
   * Get all transactions for a user with pagination
   */
  async getTransactions(
    userId: string,
    options?: {
      page?: number
      limit?: number
      type?: string
      startDate?: Date
      endDate?: Date
    },
  ): Promise<{ transactions: Transaction[]; count: number; error: Error | null }> {
    try {
      const { page = 1, limit = 20, type, startDate, endDate } = options || {}
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/transactions"

      const params = new URLSearchParams({
        userId,
        page: String(page),
        limit: String(limit),
      })

      if (type) params.append("type", type)
      if (startDate) params.append("startDate", startDate.toISOString())
      if (endDate) params.append("endDate", endDate.toISOString())

      const response = await fetch(`${API_URL}?${params.toString()}`, {
        // ANNOTATION: Add authentication headers if required by your Hostinger backend.
        // headers: {
        //   'Authorization': `Bearer ${your_auth_token}`
        // }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Failed to fetch transactions")
      }

      const data = await response.json()

      // Assuming the API returns dates as ISO strings, convert them to Date objects.
      const transactionsWithDates = data.transactions.map((tx: any) => ({
        ...tx,
        date: new Date(tx.date),
      }))

      return {
        transactions: transactionsWithDates,
        count: data.count,
        error: null,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching transactions", { error })
      return { transactions: [], count: 0, error }
    }
  },

  /**
   * Get a single transaction by ID
   */
  async getTransactionById(id: string): Promise<{ transaction: Transaction | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = `https://your-hostinger-domain.com/api/transactions/${id}`

      const response = await fetch(API_URL, {
        // ANNOTATION: Add authentication headers if required by your Hostinger backend.
        // headers: {
        //   'Authorization': `Bearer ${your_auth_token}`
        // }
      })

      if (!response.ok) {
        if (response.status === 404) {
          return { transaction: null, error: null } // Or a specific error
        }
        const errorText = await response.text()
        throw new Error(errorText || "Failed to fetch transaction")
      }

      const data = await response.json()

      // Assuming the API returns a date as an ISO string, convert it to a Date object.
      const transactionWithDate = {
        ...data,
        date: new Date(data.date),
      }

      return { transaction: transactionWithDate, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error fetching transaction by ID", { id, error })
      return { transaction: null, error }
    }
  },

  /**
   * Record a new transaction
   */
  async recordTransaction(
    data: Omit<Transaction, "id" | "date">,
  ): Promise<{ transaction: Transaction | null; error: Error | null }> {
    try {
      // ANNOTATION: Replace with your actual Hostinger API endpoint.
      const API_URL = "https://your-hostinger-domain.com/api/transactions"

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ANNOTATION: Add authentication headers if required by your Hostinger backend.
          // 'Authorization': `Bearer ${your_auth_token}`
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Failed to record transaction")
      }

      const newTransaction = await response.json()

      // Convert date string from response to a Date object
      newTransaction.date = new Date(newTransaction.date)

      return { transaction: newTransaction, error: null }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error")
      logger.error("Error recording transaction", { data, error })
      return { transaction: null, error }
    }
  },
}
