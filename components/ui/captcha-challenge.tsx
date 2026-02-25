import { MaterialIcons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'

/**
 * Generates a simple arithmetic challenge (addition or subtraction with positive result).
 * Returns the challenge string and the expected numeric answer.
 */
// Probability of generating a subtraction problem (remainder is addition).
// Slightly prefer addition for simpler user experience.
const SUBTRACTION_PROBABILITY = 0.4

function generateChallenge(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 9) + 1 // 1–9
  const b = Math.floor(Math.random() * 9) + 1 // 1–9
  const useAddition = Math.random() > SUBTRACTION_PROBABILITY
  if (useAddition || a <= b) {
    return { question: `${a} + ${b}`, answer: a + b }
  }
  return { question: `${a} - ${b}`, answer: a - b }
}

interface CaptchaChallengeProps {
  /** Called once the user enters the correct answer */
  onVerified: () => void
  /** Called when the component resets (new challenge generated) */
  onReset?: () => void
}

/**
 * A lightweight, native math-based CAPTCHA challenge suitable for mobile.
 * Provides a verification UI (arithmetic question + answer input) and calls:
 *   - `onVerified` once the user enters the correct answer
 *   - `onReset` when a new challenge is generated via the refresh button
 * The parent form is responsible for blocking submission until `onVerified`
 * has been called.
 *
 * @internal `generateChallenge` is exported for testing purposes only.
 */
export { generateChallenge }

export function CaptchaChallenge({ onVerified, onReset }: CaptchaChallengeProps) {
  const [challenge, setChallenge] = useState(generateChallenge)
  const [input, setInput] = useState('')
  const [verified, setVerified] = useState(false)
  const [wrong, setWrong] = useState(false)
  const inputRef = useRef<TextInput>(null)
  // Track whether a challenge change was triggered by an explicit user refresh
  // so we only steal keyboard focus after the refresh button is pressed.
  const refreshTriggered = useRef(false)

  const refresh = () => {
    refreshTriggered.current = true
    setChallenge(generateChallenge())
    setInput('')
    setVerified(false)
    setWrong(false)
    onReset?.()
  }

  // Auto-focus only after an explicit refresh, not on initial mount.
  useEffect(() => {
    if (!verified && refreshTriggered.current) {
      refreshTriggered.current = false
      inputRef.current?.focus()
    }
  }, [challenge, verified])

  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '')
    setInput(cleaned)
    setWrong(false)

    if (cleaned.length > 0) {
      const parsed = parseInt(cleaned, 10)
      if (parsed === challenge.answer) {
        setVerified(true)
        onVerified()
      } else if (cleaned.length >= challenge.answer.toString().length) {
        // User has typed as many digits as the answer has and they don't match
        setWrong(true)
      }
    }
  }

  return (
    <View
      className="rounded-lg border border-white/20 bg-white/5 px-4 py-3"
      accessibilityLabel="Security verification"
    >
      <Text className="text-xs text-white/60 mb-2 font-medium uppercase tracking-wide">
        Security Check
      </Text>

      {verified ? (
        <View className="flex-row items-center gap-2">
          <MaterialIcons name="check-circle" size={18} color="#34d399" />
          <Text className="text-emerald-300 text-sm">Verification passed</Text>
        </View>
      ) : (
        <>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-white text-sm">
              What is{' '}
              <Text className="font-bold text-emerald-300">{challenge.question}</Text>
              {'?'}
            </Text>
            <TouchableOpacity
              onPress={refresh}
              accessibilityLabel="Get a new challenge"
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <MaterialIcons name="refresh" size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={handleChange}
            placeholder="Enter answer"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
            maxLength={3} // max possible answer: 9+9=18 (2 digits); 3 gives room for any future range change
            className={`w-full bg-white/5 rounded px-3 py-2 text-white ${wrong ? 'border border-red-400' : ''}`}
            accessibilityLabel={`Enter the answer to ${challenge.question}`}
          />

          {wrong && (
            <Text className="text-xs text-red-400 mt-1">Incorrect answer. Please try again.</Text>
          )}
        </>
      )}
    </View>
  )
}
