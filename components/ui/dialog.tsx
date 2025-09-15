import * as React from "react"
import { View, Text, TouchableOpacity, Modal, ViewProps } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"

import { cn } from "lib/utils"

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({ open = false, onOpenChange, children }) => {
  const [internalOpen, setInternalOpen] = React.useState(open);
  
  const isControlled = onOpenChange !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  
  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    if (isControlled) {
      onOpenChange?.(newOpen);
    } else {
      setInternalOpen(newOpen);
    }
  }, [isControlled, onOpenChange]);

  React.useEffect(() => {
    if (isControlled) {
      setInternalOpen(open);
    }
  }, [open, isControlled]);

  const contextValue = React.useMemo(() => ({
    open: isOpen,
    onOpenChange: handleOpenChange
  }), [isOpen, handleOpenChange]);

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
    </DialogContext.Provider>
  );
};

interface DialogTriggerProps extends TouchableOpacity['props'] {
  asChild?: boolean;
}

const DialogTrigger = React.forwardRef<TouchableOpacity, DialogTriggerProps>(
  ({ children, onPress, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    
    if (!context) {
      throw new Error("DialogTrigger must be used within a Dialog");
    }

    const handlePress = (event: any) => {
      context.onOpenChange(true);
      onPress?.(event);
    };

    return (
      <TouchableOpacity ref={ref} onPress={handlePress} {...props}>
        {children}
      </TouchableOpacity>
    );
  }
);
DialogTrigger.displayName = "DialogTrigger";

const DialogPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

interface DialogOverlayProps extends ViewProps {
  className?: string;
}

const DialogOverlay = React.forwardRef<View, DialogOverlayProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
);
DialogOverlay.displayName = "DialogOverlay";

interface DialogContentProps extends ViewProps {
  className?: string;
}

const DialogContent = React.forwardRef<View, DialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    
    if (!context) {
      throw new Error("DialogContent must be used within a Dialog");
    }

    const { open, onOpenChange } = context;

    return (
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => onOpenChange(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/80">
          <View
            ref={ref}
            className={cn(
              "bg-white rounded-lg p-6 mx-4 max-w-lg w-full shadow-lg",
              className
            )}
            {...props}
          >
            {children}
            <TouchableOpacity
              className="absolute right-4 top-4 rounded-sm opacity-70"
              onPress={() => onOpenChange(false)}
            >
              <MaterialIcons name="close" size={16} color="#666" />
              <Text className="sr-only">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }
);
DialogContent.displayName = "DialogContent";

interface DialogHeaderProps extends ViewProps {
  className?: string;
}

const DialogHeader = React.forwardRef<View, DialogHeaderProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className
      )}
      {...props}
    />
  )
);
DialogHeader.displayName = "DialogHeader";

interface DialogFooterProps extends ViewProps {
  className?: string;
}

const DialogFooter = React.forwardRef<View, DialogFooterProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className
      )}
      {...props}
    />
  )
);
DialogFooter.displayName = "DialogFooter";

interface DialogTitleProps extends ViewProps {
  className?: string;
}

const DialogTitle = React.forwardRef<View, DialogTitleProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className
      )}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text className="text-lg font-semibold">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
);
DialogTitle.displayName = "DialogTitle";

interface DialogDescriptionProps extends ViewProps {
  className?: string;
}

const DialogDescription = React.forwardRef<View, DialogDescriptionProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text className="text-sm text-gray-600">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
);
DialogDescription.displayName = "DialogDescription";

const DialogClose = React.forwardRef<TouchableOpacity, TouchableOpacity['props']>(
  ({ children, onPress, ...props }, ref) => {
    const context = React.useContext(DialogContext);
    
    if (!context) {
      throw new Error("DialogClose must be used within a Dialog");
    }

    const handlePress = (event: any) => {
      context.onOpenChange(false);
      onPress?.(event);
    };

    return (
      <TouchableOpacity ref={ref} onPress={handlePress} {...props}>
        {children}
      </TouchableOpacity>
    );
  }
);
DialogClose.displayName = "DialogClose";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
