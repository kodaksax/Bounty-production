import { useState, useCallback, useMemo } from 'react';

type ValidationRule = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: any) => string | undefined;
};

type ValidationRules<T> = {
  [K in keyof T]?: ValidationRule;
};

type ValidationErrors<T> = {
  [K in keyof T]?: string;
};

type UseFormValidationResult<T> = {
  values: Partial<T>;
  errors: ValidationErrors<T>;
  touched: { [K in keyof T]?: boolean };
  isValid: boolean;
  isSubmitting: boolean;
  setValue: (field: keyof T, value: any) => void;
  setError: (field: keyof T, error: string) => void;
  clearError: (field: keyof T) => void;
  validateField: (field: keyof T) => boolean;
  validateAll: () => boolean;
  handleSubmit: (onSubmit: (values: T) => Promise<void> | void) => Promise<void>;
  reset: () => void;
  setTouched: (field: keyof T) => void;
};

export function useFormValidation<T extends Record<string, any>>(
  initialValues: Partial<T>,
  validationRules: ValidationRules<T>
): UseFormValidationResult<T> {
  const [values, setValues] = useState<Partial<T>>(initialValues);
  const [errors, setErrors] = useState<ValidationErrors<T>>({});
  const [touched, setTouchedState] = useState<{ [K in keyof T]?: boolean }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateField = useCallback((field: keyof T): boolean => {
    const value = values[field];
    const rules = validationRules[field];
    
    if (!rules) return true;

    let error: string | undefined;

    // Required validation
    if (rules.required && (value === undefined || value === null || value === '')) {
      error = 'This field is required';
    }
    
    // Min length validation
    else if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
      error = `Minimum length is ${rules.minLength} characters`;
    }
    
    // Max length validation
    else if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
      error = `Maximum length is ${rules.maxLength} characters`;
    }
    
    // Pattern validation
    else if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
      error = 'Invalid format';
    }
    
    // Custom validation
    else if (rules.custom && value !== undefined) {
      error = rules.custom(value);
    }

    // Update errors state
    setErrors(prev => ({
      ...prev,
      [field]: error
    }));

    return !error;
  }, [values, validationRules]);

  const validateAll = useCallback((): boolean => {
    const fields = Object.keys(validationRules) as (keyof T)[];
    const results = fields.map(field => validateField(field));
    return results.every(Boolean);
  }, [validateField, validationRules]);

  const setValue = useCallback((field: keyof T, value: any) => {
    setValues(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  }, [errors]);

  const setError = useCallback((field: keyof T, error: string) => {
    setErrors(prev => ({ ...prev, [field]: error }));
  }, []);

  const clearError = useCallback((field: keyof T) => {
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }, []);

  const setTouched = useCallback((field: keyof T) => {
    setTouchedState(prev => ({ ...prev, [field]: true }));
  }, []);

  const handleSubmit = useCallback(async (
    onSubmit: (values: T) => Promise<void> | void
  ) => {
    setIsSubmitting(true);
    
    // Mark all fields as touched
    const touchedFields = Object.keys(validationRules).reduce((acc, field) => ({
      ...acc,
      [field]: true
    }), {} as { [K in keyof T]: boolean });
    setTouchedState(touchedFields);

    try {
      if (validateAll()) {
        await onSubmit(values as T);
      }
    } catch (error) {
      console.error('Form submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [values, validateAll, validationRules]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouchedState({});
    setIsSubmitting(false);
  }, [initialValues]);

  const isValid = useMemo(() => {
    const fields = Object.keys(validationRules) as (keyof T)[];
    return fields.every(field => !errors[field]);
  }, [errors, validationRules]);

  return {
    values,
    errors,
    touched,
    isValid,
    isSubmitting,
    setValue,
    setError,
    clearError,
    validateField,
    validateAll,
    handleSubmit,
    reset,
    setTouched,
  };
}

// Common validation patterns
export const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-\(\)]{10,}$/,
  url: /^https?:\/\/.+/,
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
};

// Common validation rules
export const CommonValidationRules = {
  required: { required: true },
  email: { 
    required: true, 
    pattern: ValidationPatterns.email,
    custom: (value: string) => {
      if (value && !ValidationPatterns.email.test(value)) {
        return 'Please enter a valid email address';
      }
    }
  },
  phone: {
    pattern: ValidationPatterns.phone,
    custom: (value: string) => {
      if (value && !ValidationPatterns.phone.test(value)) {
        return 'Please enter a valid phone number';
      }
    }
  },
  strongPassword: {
    required: true,
    minLength: 8,
    custom: (value: string) => {
      if (value && !ValidationPatterns.strongPassword.test(value)) {
        return 'Password must contain at least 8 characters with uppercase, lowercase, number, and special character';
      }
    }
  },
  minAmount: (min: number) => ({
    required: true,
    custom: (value: number) => {
      if (value !== undefined && value < min) {
        return `Amount must be at least $${min}`;
      }
    }
  }),
  maxAmount: (max: number) => ({
    custom: (value: number) => {
      if (value !== undefined && value > max) {
        return `Amount cannot exceed $${max}`;
      }
    }
  }),
};