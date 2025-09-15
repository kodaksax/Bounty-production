import * as React from "react"
import { View, Text, Image, StyleSheet } from "react-native"

interface AvatarProps {
  style?: any
  children?: React.ReactNode
}

interface AvatarImageProps {
  src?: string
  alt?: string
  style?: any
}

interface AvatarFallbackProps {
  style?: any
  children?: React.ReactNode
}

const Avatar = React.forwardRef<View, AvatarProps>(
  ({ style, children, ...props }, ref) => (
    <View
      ref={ref}
      style={[avatarStyles.avatar, style]}
      {...props}
    >
      {children}
    </View>
  )
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<Image, AvatarImageProps>(
  ({ style, src, alt, ...props }, ref) => (
    <Image
      ref={ref}
      source={{ uri: src || "/placeholder.svg?height=40&width=40" }}
      style={[avatarStyles.image, style]}
      accessibilityLabel={alt}
      {...props}
    />
  )
)
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<View, AvatarFallbackProps>(
  ({ style, children, ...props }, ref) => (
    <View
      ref={ref}
      style={[avatarStyles.fallback, style]}
      {...props}
    >
      {children}
    </View>
  )
)
AvatarFallback.displayName = "AvatarFallback"

const avatarStyles = StyleSheet.create({
  avatar: {
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6', // muted
  },
})

export { Avatar, AvatarImage, AvatarFallback }
