"use client"

import type React from "react";
import { Text, View } from "react-native";

import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Alert, AlertDescription } from "components/ui/alert";
import { Button } from "components/ui/button";
import { Checkbox } from "components/ui/checkbox";
import { Input } from "components/ui/input";
import { Label } from "components/ui/label";
import { Textarea } from "components/ui/textarea";
import type { BountyFormValues } from "lib/types"; // Assuming you move types here
import { useState } from "react";
import type { z } from "zod";

// This schema was previously in lib/supabase/schema.
// You should keep validation, so we define it here or in a shared types file.
import { z as zod } from "zod";
export const bountySchema = zod.object({
  title: zod.string().min(5, "Title must be at least 5 characters"),
  description: zod.string().min(20, "Description must be at least 20 characters"),
  amount: zod.number().min(0, "Amount cannot be negative"),
  is_for_honor: zod.boolean(),
  location: zod.string().min(3, "Location is required"),
  timeline: zod.string().optional(),
  skills_required: zod.string().optional(),
})

interface BountyFormProps {
  defaultValues?: Partial<BountyFormValues>
  onSuccess?: (bounty: any) => void
  isEditMode?: boolean
  bountyId?: number
}

export function BountyForm({ defaultValues, onSuccess, isEditMode = false, bountyId }: BountyFormProps) {
  const navigation = useNavigation()
  // TODO: Replace with your own auth state management (e.g., a React Context)
  // const { user } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<BountyFormValues>({
    title: defaultValues?.title || "",
    description: defaultValues?.description || "",
    amount: defaultValues?.amount || 0,
    is_for_honor: defaultValues?.is_for_honor || false,
    location: defaultValues?.location || "",
    timeline: defaultValues?.timeline || "",
    skills_required: defaultValues?.skills_required || "",
    status: defaultValues?.status || "open",
  })

  const [errors, setErrors] = useState<z.ZodIssue[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleCheckboxChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }))
  }

  const handleSubmit = async () => {
    setErrors([])
    setSubmitError(null)

    try {
      // Validate the form data
      const validated = bountySchema.safeParse(formData)
      if (!validated.success) {
        setErrors(validated.error.issues)
        return
      }

      // TODO: Get the auth token you stored after login
      // const authToken = AsyncStorage.getItem('authToken');
      // if (!authToken) {
      //   setSubmitError("You must be signed in to post a bounty");
      //   return;
      // }

      setIsSubmitting(true)

      const endpoint = isEditMode
        ? `https://your-hostinger-api.com/bounties/${bountyId}` // TODO: Hostinger API endpoint
        : "https://your-hostinger-api.com/bounties" // TODO: Hostinger API endpoint

      const method = isEditMode ? "PUT" : "POST"

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          // "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify(formData),
      })

      const result = await response.json()

      if (!response.ok) {
        setSubmitError(result.message || "Failed to save bounty")
        return
      }

      // Handle success
      if (onSuccess) {
        onSuccess(result)
      } else {
        ;(navigation as any).navigate("Dashboard")
      }
    } catch (err) {
      setSubmitError("An unexpected error occurred")
      console.error(err)
    }
    finally {
      setIsSubmitting(false)
    }
  }

  const getFieldError = (field: string) => {
    return errors.find((error) => error.path[0] === field)?.message
  }

  return (
    <View className="space-y-6">
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
      
      {/* Safety Tips Banner */}
      <View className="bg-emerald-700/30 rounded-lg p-3 border border-emerald-500/30">
        <View className="flex-row items-center mb-2">
          <MaterialIcons name="security" size={18} color="#10b981" />
          <Text className="text-sm font-medium text-white ml-2">Safety Tips</Text>
        </View>
        <Text className="text-xs text-emerald-200 leading-5">
          • Never share personal info (address, phone, SSN) outside the app{'\n'}
          • Always use in-app payments for secure transactions{'\n'}
          • Meet in public places for in-person bounties{'\n'}
          • Report suspicious activity immediately
        </Text>
      </View>

      <View className="space-y-2">
        <Label>Title</Label>
        <Input
          value={formData.title}
          onChangeText={(text: string) => setFormData((prev) => ({ ...prev, title: text }))}
          placeholder="A brief description of the job you need done"
          editable={!isSubmitting}
        />
        {getFieldError("title") && <Text className="text-sm text-red-500">{getFieldError("title")}</Text>}
      </View>

      <View className="space-y-2">
        <Label>Bounty Description</Label>
        <Textarea
          value={formData.description}
          onChangeText={(text: string) => setFormData((prev) => ({ ...prev, description: text }))}
          placeholder="Detailed description of the task"
          numberOfLines={4}
          editable={!isSubmitting}
        />
        {getFieldError("description") && <Text className="text-sm text-red-500">{getFieldError("description")}</Text>}
      </View>

      <View className="space-y-2">
        <Label>Location</Label>
        <Input
          value={formData.location}
          onChangeText={(text: string) => setFormData((prev) => ({ ...prev, location: text }))}
          placeholder="Where the task should be performed"
          editable={!isSubmitting}
        />
        {getFieldError("location") && <Text className="text-sm text-red-500">{getFieldError("location")}</Text>}
      </View>

      <View className="space-y-2">
        <View className="flex items-center gap-2">
          <Checkbox
            id="is_for_honor"
            checked={formData.is_for_honor}
            onCheckedChange={(checked: boolean | 'indeterminate' | undefined) =>
              handleCheckboxChange("is_for_honor", !!checked)
            }
            disabled={isSubmitting}
          />
          <Label>For Honor (No monetary reward)</Label>
        </View>
      </View>

      {!formData.is_for_honor && (
        <View className="space-y-2">
          <Label>Bounty Amount ($)</Label>
          <Input
            value={formData.amount.toString()}
            onChangeText={(text: string) => setFormData((prev) => ({ ...prev, amount: Number.parseFloat(text) || 0 }))}
            keyboardType="numeric"
            editable={!isSubmitting}
          />
          {getFieldError("amount") && <Text className="text-sm text-red-500">{getFieldError("amount")}</Text>}
        </View>
      )}

      <View className="space-y-2">
        <Label>Timeline</Label>
        <Input
          value={formData.timeline}
          onChangeText={(text: string) => setFormData((prev) => ({ ...prev, timeline: text }))}
          placeholder="When does this need to be completed by?"
          editable={!isSubmitting}
        />
        {getFieldError("timeline") && <Text className="text-sm text-red-500">{getFieldError("timeline")}</Text>}
      </View>

      <View className="space-y-2">
        <Label>Skills Required</Label>
        <Input
          value={formData.skills_required}
          onChangeText={(text: string) => setFormData((prev) => ({ ...prev, skills_required: text }))}
          placeholder="What skills are needed for this bounty?"
          editable={!isSubmitting}
        />
        {getFieldError("skills_required") && <Text className="text-sm text-red-500">{getFieldError("skills_required")}</Text>}
      </View>

      <Button onPress={handleSubmit} className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <MaterialIcons name="hourglass-top" size={16} style={{ marginRight: 8 }} />
            {isEditMode ? "Updating..." : "Posting..."}
          </>
        ) : isEditMode ? (
          "Update Bounty"
        ) : (
          "Post Bounty"
        )}
      </Button>
    </View>
  )
}
