"use client"

import type React from "react"

import type { BountyFormValues } from "lib/types"; // Assuming you move types here
import { Alert, AlertDescription } from "components/ui/alert"
import { Button } from "components/ui/button"
import { Checkbox } from "components/ui/checkbox"
import { Input } from "components/ui/input"
import { Label } from "components/ui/label"
import { Textarea } from "components/ui/textarea"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { z } from "zod"

// This schema was previously in lib/supabase/schema.
// You should keep validation, so we define it here or in a shared types file.
import { z as zod } from "zod"
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
  const router = useRouter()
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleCheckboxChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
      // const authToken = localStorage.getItem('authToken');
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
        router.push("/dashboard")
        router.refresh()
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          value={formData.title}
          onChange={handleChange}
          placeholder="A brief description of the job you need done"
          aria-invalid={!!getFieldError("title")}
          disabled={isSubmitting}
        />
        {getFieldError("title") && <p className="text-sm text-red-500">{getFieldError("title")}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Bounty Description</Label>
        <Textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Detailed description of the task"
          rows={4}
          aria-invalid={!!getFieldError("description")}
          disabled={isSubmitting}
        />
        {getFieldError("description") && <p className="text-sm text-red-500">{getFieldError("description")}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder="Where the task should be performed"
          aria-invalid={!!getFieldError("location")}
          disabled={isSubmitting}
        />
        {getFieldError("location") && <p className="text-sm text-red-500">{getFieldError("location")}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="is_for_honor"
            checked={formData.is_for_honor}
            onCheckedChange={(checked) => handleCheckboxChange("is_for_honor", !!checked)}
            disabled={isSubmitting}
          />
          <Label htmlFor="is_for_honor">For Honor (No monetary reward)</Label>
        </div>
      </div>

      {!formData.is_for_honor && (
        <div className="space-y-2">
          <Label htmlFor="amount">Bounty Amount ($)</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            value={formData.amount.toString()}
            onChange={(e) => setFormData((prev) => ({ ...prev, amount: Number.parseFloat(e.target.value) || 0 }))}
            min="0"
            step="0.01"
            aria-invalid={!!getFieldError("amount")}
            disabled={isSubmitting}
          />
          {getFieldError("amount") && <p className="text-sm text-red-500">{getFieldError("amount")}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="timeline">Timeline</Label>
        <Input
          id="timeline"
          name="timeline"
          value={formData.timeline}
          onChange={handleChange}
          placeholder="When does this need to be completed by?"
          aria-invalid={!!getFieldError("timeline")}
          disabled={isSubmitting}
        />
        {getFieldError("timeline") && <p className="text-sm text-red-500">{getFieldError("timeline")}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="skills_required">Skills Required</Label>
        <Input
          id="skills_required"
          name="skills_required"
          value={formData.skills_required}
          onChange={handleChange}
          placeholder="What skills are needed for this bounty?"
          aria-invalid={!!getFieldError("skills_required")}
          disabled={isSubmitting}
        />
        {getFieldError("skills_required") && <p className="text-sm text-red-500">{getFieldError("skills_required")}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {isEditMode ? "Updating..." : "Posting..."}
          </>
        ) : isEditMode ? (
          "Update Bounty"
        ) : (
          "Post Bounty"
        )}
      </Button>
    </form>
  )
}
