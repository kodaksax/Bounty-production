import * as React from "react"
import { View, Text, TouchableOpacity, Modal, ViewProps } from "react-native"

import { cn } from "lib/utils"
import { buttonVariants } from "components/ui/button"

interface AlertDialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null);

interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const AlertDialog: React.FC<AlertDialogProps> = ({ open = false, onOpenChange, children }) => {
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
    <AlertDialogContext.Provider value={contextValue}>
      {children}
    </AlertDialogContext.Provider>
  );
};

interface AlertDialogTriggerProps extends Omit<React.ComponentPropsWithRef<typeof TouchableOpacity>, 'onPress'> {
  onPress?: React.ComponentPropsWithRef<typeof TouchableOpacity>['onPress'];
  asChild?: boolean;
}

const AlertDialogTrigger = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, AlertDialogTriggerProps>(
  ({ children, onPress, ...props }, ref) => {
     const context = React.useContext(AlertDialogContext);
     
     if (!context) {
       throw new Error("AlertDialogTrigger must be used within an AlertDialog");
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
AlertDialogTrigger.displayName = "AlertDialogTrigger";

const AlertDialogPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

interface AlertDialogOverlayProps extends ViewProps {
  className?: string;
}

const AlertDialogOverlay = React.forwardRef<View, AlertDialogOverlayProps>(
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
AlertDialogOverlay.displayName = "AlertDialogOverlay";

interface AlertDialogContentProps extends ViewProps {
  className?: string;
}

const AlertDialogContent = React.forwardRef<View, AlertDialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(AlertDialogContext);
    
    if (!context) {
      throw new Error("AlertDialogContent must be used within an AlertDialog");
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
          </View>
        </View>
      </Modal>
    );
  }
);
AlertDialogContent.displayName = "AlertDialogContent";

interface AlertDialogHeaderProps extends ViewProps {
  className?: string;
}

const AlertDialogHeader = React.forwardRef<View, AlertDialogHeaderProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className
      )}
      {...props}
    />

  )
);
AlertDialogHeader.displayName = "AlertDialogHeader";

interface AlertDialogFooterProps extends ViewProps {
  className?: string;
}

const AlertDialogFooter = React.forwardRef<View, AlertDialogFooterProps>(
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
AlertDialogFooter.displayName = "AlertDialogFooter";

interface AlertDialogTitleProps extends ViewProps {
  className?: string;
}

const AlertDialogTitle = React.forwardRef<View, AlertDialogTitleProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn("text-lg font-semibold", className)}
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
AlertDialogTitle.displayName = "AlertDialogTitle";

interface AlertDialogDescriptionProps extends ViewProps {
  className?: string;
}

const AlertDialogDescription = React.forwardRef<View, AlertDialogDescriptionProps>(
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
AlertDialogDescription.displayName = "AlertDialogDescription";

interface AlertDialogActionProps extends React.ComponentPropsWithRef<typeof TouchableOpacity> {
  className?: string;
}

const AlertDialogAction = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, AlertDialogActionProps>(
  ({ className, children, onPress, ...props }, ref) => {
    const context = React.useContext(AlertDialogContext);
    
    if (!context) {
      throw new Error("AlertDialogAction must be used within an AlertDialog");
    }

    const handlePress = (event: any) => {
      onPress?.(event);
      context.onOpenChange(false);
    };

    return (
      <TouchableOpacity
        ref={ref}
        className={cn(buttonVariants(), className)}
        onPress={handlePress}
        {...props}
      >
        {typeof children === 'string' ? (
          <Text className="text-inherit font-inherit">{children}</Text>
        ) : (
          children
        )}
      </TouchableOpacity>
    );
  }
);
AlertDialogAction.displayName = "AlertDialogAction";

interface AlertDialogCancelProps extends React.ComponentPropsWithRef<typeof TouchableOpacity> {
  className?: string;
}

const AlertDialogCancel = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, AlertDialogCancelProps>(
  ({ className, children, onPress, ...props }, ref) => {
     const context = React.useContext(AlertDialogContext);
     
     if (!context) {
       throw new Error("AlertDialogCancel must be used within an AlertDialog");
     }

    const handlePress = (event: any) => {
      onPress?.(event);
      context.onOpenChange(false);
    };

    return (
      <TouchableOpacity
        ref={ref}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "mt-2 sm:mt-0",
          className
        )}
        onPress={handlePress}
        {...props}
      >
        {typeof children === 'string' ? (
          <Text className="text-inherit font-inherit">{children}</Text>
        ) : (
          children
        )}
      </TouchableOpacity>
    );
  }
);
AlertDialogCancel.displayName = "AlertDialogCancel";


export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
