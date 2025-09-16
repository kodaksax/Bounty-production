"use client"

import React, { forwardRef, useId } from "react";
import { Text, View, ViewProps } from "react-native"
// Removed web-only label imports
import {
  Controller,
  ControllerProps,
  FieldPath,
  FieldValues,
  FormProvider,
  useFormContext,
} from "react-hook-form"

import { Label } from "components/ui/label"
import { cn } from "lib/utils"

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
)

type FormItemProps = ViewProps;

const FormItem = forwardRef<View, FormItemProps>((props, ref) => {
  const id = useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <View ref={ref} {...props} />
    </FormItemContext.Provider>
  );
});

FormItem.displayName = "FormItem";

type FormLabelProps = {
  style?: any;
  children?: React.ReactNode;
};
const FormLabel = ({ style, children }: FormLabelProps) => {
  const { error, formItemId } = useFormField();
  const labelStyle = error ? { color: 'red' } : {};

  return (
    <View style={[labelStyle, style]}>
      <Label>{children}</Label>
    </View>
  );
};

FormLabel.displayName = "FormLabel";

// Removed Slot and web-only FormControl

const FormDescription: React.FC<{ style?: any; children?: React.ReactNode }> = ({ style, children }) => {
  return (
    <Text style={[{ fontSize: 14, color: "#6b7280" }, style]}>
      {children}
    </Text>
  );
};
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message) : children;

  if (!body) return null; // Return null if nothing to show

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={className}
      {...props}
      style={{ color: error ? "red" : "#6b7280", fontSize: 14 }}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = "FormMessage";