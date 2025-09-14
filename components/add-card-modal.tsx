"use client"

import type React from "react"

import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { cn } from "lib/utils"

interface AddCardModalProps {
  onBack: () => void
  onSave?: (cardData: CardData) => void
}

interface CardData {
  cardNumber: string
  cardholderName: string
  expiryDate: string
  securityCode: string
}

export function AddCardModal({ onBack, onSave }: AddCardModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [cardholderName, setCardholderName] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [securityCode, setSecurityCode] = useState("")

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, "")
    const groups = []

    for (let i = 0; i < digits.length && i < 16; i += 4) {
      groups.push(digits.slice(i, i + 4))
    }

    return groups.join(" ")
  }

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCardNumber(e.target.value)
    setCardNumber(formatted)
  }

  const handleExpiryDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "")
    if (value.length <= 4) {
      const month = value.slice(0, 2)
      const year = value.slice(2, 4)

      if (value.length <= 2) {
        setExpiryDate(value)
      } else {
        setExpiryDate(`${month}/${year}`)
      }
    }
  }

  const handleSave = () => {
    if (onSave) {
      onSave({
        cardNumber,
        cardholderName,
        expiryDate,
        securityCode,
      })
    }
  }

  const isFormValid =
    cardNumber.length >= 19 && cardholderName.trim() !== "" && expiryDate.length >= 5 && securityCode.length >= 3

  return (
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pt-8">
        <button onClick={onBack} className="p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-medium">Add Card</h1>
        <div className="w-5"></div> {/* Empty div for spacing */}
      </div>

      {/* Instructions */}
      <div className="px-4 py-2">
        <p className="text-sm text-emerald-200">
          Start typing to add your credit card details.
          <br />
          Everything will update according to your data.
        </p>
      </div>

      {/* Card Preview */}
      <div className="px-4 py-4">
        <div className="bg-emerald-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center">
              <div className="flex h-8">
                <div className="h-8 w-8 rounded-full bg-red-500"></div>
                <div className="h-8 w-8 rounded-full bg-yellow-500 -ml-4"></div>
              </div>
            </div>
          </div>

          <div className="text-lg font-medium mb-6 tracking-wider">{cardNumber || "1244 1234 1345 3255"}</div>

          <div className="flex justify-between items-end">
            <div>
              <p className="text-xs text-emerald-300 mb-1">Name</p>
              <p className="font-medium">{cardholderName || "Yessie"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-emerald-300 mb-1">Expires</p>
              <p className="font-medium">{expiryDate || "MM/YY"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="px-4 py-2 flex-1">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm text-emerald-200">Card Number</label>
            <input
              type="text"
              value={cardNumber}
              onChange={handleCardNumberChange}
              placeholder="1244 1234 1345 3255"
              maxLength={19}
              className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-emerald-200">Cardholder Name</label>
            <input
              type="text"
              value={cardholderName}
              onChange={(e) => setCardholderName(e.target.value)}
              placeholder="Yessie"
              className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-emerald-200">Expiry Date</label>
              <input
                type="text"
                value={expiryDate}
                onChange={handleExpiryDateChange}
                placeholder="MM/YY"
                maxLength={5}
                className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm text-emerald-200">Security Code</label>
              <input
                type="password"
                value={securityCode}
                onChange={(e) => setSecurityCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="•••"
                maxLength={4}
                className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="p-4 pb-8">
        <button
          onClick={handleSave}
          disabled={!isFormValid}
          className={cn(
            "w-full py-3 rounded-full text-center font-medium",
            isFormValid
              ? "bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              : "bg-gray-700/50 text-gray-300 cursor-not-allowed",
          )}
        >
          Save
        </button>
      </div>
    </div>
  )
}
