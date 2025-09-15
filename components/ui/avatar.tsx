import * as React from "react"
import { View, Text, Image, ViewProps, ImageProps, TextProps } from "react-native"

import { cn } from "lib/utils"

interface AvatarProps extends ViewProps {
  className?: string;
}

const Avatar = React.forwardRef<View, AvatarProps>(
  ({ className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
        className
      )}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        overflow: 'hidden',
        position: 'relative',
      }}
      {...props}
    />
  )
);
Avatar.displayName = "Avatar";

interface AvatarImageProps extends Omit<ImageProps, 'source'> {
  src?: string;
  alt?: string;
  className?: string;
}

const AvatarImage = React.forwardRef<Image, AvatarImageProps>(
  ({ className, src, alt, ...props }, ref) => {
    const [hasError, setHasError] = React.useState(false);
    
    if (!src || hasError) {
      return null;
    }

    return (
      <Image
        ref={ref}
        source={{ uri: src }}
        onError={() => setHasError(true)}
        className={cn("aspect-square h-full w-full", className)}
        style={{
          width: '100%',
          height: '100%',
        }}
        {...props}
      />
    );
  }
);
AvatarImage.displayName = "AvatarImage";

interface AvatarFallbackProps extends ViewProps {
  className?: string;
  children?: React.ReactNode;
}

const AvatarFallback = React.forwardRef<View, AvatarFallbackProps>(
  ({ className, children, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted",
        className
      )}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#f5f5f5',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#666' }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  )
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback }
