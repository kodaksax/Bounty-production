# ---------------------------------------------------------------------------
# Bounty — Android R8 keep rules
# ---------------------------------------------------------------------------
#
# Appended to android/app/proguard-rules.pro by expo-build-properties
# (see the `extraProguardRules` wiring in app.config.js).
#
# WHY THIS FILE EXISTS
# Google Play's technical quality requirements add a "DEX code optimization"
# metric enforced from February 2027: an app whose DEX exceeds 10 MB must show
# at least 25% coverage for each of obfuscation, optimization and shrinking,
# produced by a tool such as R8. Bounty previously shipped with R8 disabled
# entirely (`android.enableMinifyInReleaseBuilds` defaults to false in the
# Expo/React Native template), so all three figures were 0%.
#
# DESIGN RULE FOR EDITING THIS FILE
# Bounty is a live marketplace handling real money. Prefer an over-broad keep
# rule to a clever narrow one: a wrongly-stripped class in Stripe, Supabase
# auth, notifications or deep links is a production money/lockout incident,
# whereas an extra kept class costs a few KB. Do NOT add -repackageclasses,
# -overloadaggressively, or -assumenosideeffects here.
#
# Most first-party React Native and Expo modules ship their own
# `consumer-rules.pro` inside their AAR, which R8 applies automatically. The
# rules below are deliberate belt-and-braces for the reflective, JNI and
# annotation-driven paths that have historically broken in RN apps.

# --- Crash-report readability -------------------------------------------
# Keep source/line metadata so Play Console and Sentry stack traces stay
# actionable. AGP embeds the R8 mapping file into the AAB automatically
# (BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map), so Play
# Console de-obfuscates uploaded builds without any extra step.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Reflection-critical attributes. Kotlin/Gson/Moshi-style deserialization in
# third-party SDKs reads these at runtime.
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes *Annotation*,RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

# --- JNI ------------------------------------------------------------------
# Any method called from C++ must keep its name.
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# --- React Native core ----------------------------------------------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStripAny
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keep @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.hermes.** { *; }
-keepclassmembers class *  { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class *  { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }
-keepclassmembers class *  { @com.facebook.react.bridge.ReactMethod <methods>; }

# --- Expo modules ---------------------------------------------------------
# expo-modules-core resolves module definitions and their argument types
# reflectively at runtime; obfuscating them breaks every Expo native module
# (SecureStore, Notifications, ImagePicker, Location, Updates, ...).
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.core.interfaces.Package { *; }
-keepclassmembers class * { @expo.modules.core.interfaces.ExpoMethod <methods>; }

# --- Payments (Stripe + Stripe Identity) ----------------------------------
# Highest-risk surface in the app: a stripped model class surfaces as a failed
# payment or a stuck payout rather than a crash.
-keep class com.stripe.** { *; }
-keep interface com.stripe.** { *; }
-dontwarn com.stripe.**
-keep class com.reactnativestripesdk.** { *; }

# --- Auth / identity ------------------------------------------------------
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }
-dontwarn com.google.android.gms.**
-keep class com.reactnativegooglesignin.** { *; }

# --- Deep links (Branch) --------------------------------------------------
-keep class io.branch.** { *; }
-dontwarn io.branch.**

# --- Notifications (Firebase Cloud Messaging) -----------------------------
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# --- Maps -----------------------------------------------------------------
-keep class com.google.android.gms.maps.** { *; }
-keep class com.rnmaps.maps.** { *; }

# --- Observability --------------------------------------------------------
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# --- Networking -----------------------------------------------------------
# OkHttp/Okio ship consumer rules but historically emit warnings for optional
# Conscrypt/BouncyCastle/Animal-Sniffer references that fail the build.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Images / animation ---------------------------------------------------
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.fresco.** { *; }
-dontwarn com.facebook.fresco.**
-keep class com.bumptech.glide.** { *; }
-dontwarn com.bumptech.glide.**
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.horcrux.svg.** { *; }

# --- Kotlin ---------------------------------------------------------------
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**
