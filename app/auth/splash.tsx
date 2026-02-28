import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE_URL } from '../../lib/config/api';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
import type * as ExpoSplashScreen from 'expo-splash-screen';
import { colors } from '../../lib/theme';
// Centralized helpers: RootLayout (and any other callers) should use these
// to show/hide the native splash. Keeping them here ensures "use splash.tsx
// for any splash things" without scattering imports of expo-splash-screen.
// Cache the native module reference after the first lazy-load
let cachedExpoSplash: typeof import('expo-splash-screen') | null = null;

function getExpoSplashModule(): typeof import('expo-splash-screen') | null {
	if (cachedExpoSplash) return cachedExpoSplash;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
		cachedExpoSplash = require('expo-splash-screen') as typeof import('expo-splash-screen');
	} catch (e) {
		// Log at debug level to aid troubleshooting when the native module isn't available
		// Do not throw — absence is expected in some runtimes (Expo Go, web, CI)
		console.debug(
			'[Splash] expo-splash-screen native module not available (expected in Expo Go, web, or CI environments):',
			e,
		);
		console.debug('[Splash] expo-splash-screen not available:', e);
		cachedExpoSplash = null;
	}
	return cachedExpoSplash;
}

export async function showNativeSplash() {
	try {
		const ExpoSplash = getExpoSplashModule();
		if (ExpoSplash && typeof ExpoSplash.preventAutoHideAsync === 'function') {
			await ExpoSplash.preventAutoHideAsync();
		}
	} catch {
		// ignore if already prevented or not applicable
	}
}

export async function hideNativeSplashSafely() {
	try {
		const ExpoSplash = getExpoSplashModule();
		if (ExpoSplash && typeof ExpoSplash.hideAsync === 'function') {
			await ExpoSplash.hideAsync();
		}
	} catch {
		// ignore when no native splash is registered for current view controller
	}
}

export interface BrandedSplashProps {
	onReady?: () => void; // Optional callback when any internal animation completes
}

export const BrandedSplash: React.FC<BrandedSplashProps> = ({ onReady }) => {
	// Ensure safe area/status bar color matches branded splash
	useScreenBackground('#15803d');

	const [devHealthOk, setDevHealthOk] = useState<boolean | null>(null)
	const [devHealthMsg, setDevHealthMsg] = useState<string | null>(null)

	useEffect(() => {
		// Optionally notify parent after brief delay (animation placeholder)
		const t = setTimeout(() => { onReady?.(); }, 600);
		return () => clearTimeout(t);
	}, [onReady]);

	// Dev-only health check: quick, non-blocking check of backend
	useEffect(() => {
		if (!__DEV__) return;

		let cancelled = false;
		const check = async () => {
			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 3000);
				const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
				clearTimeout(timeout);
				if (cancelled) return;
				if (res && res.ok) {
					setDevHealthOk(true)
					setDevHealthMsg(null)
				} else {
					setDevHealthOk(false)
					setDevHealthMsg(`Dev server responded ${res?.status || 'unknown'}`)
				}
			} catch (err: any) {
				if (cancelled) return;
				setDevHealthOk(false)
				const message = err?.name === 'AbortError' ? 'Timed out' : (err?.message || String(err))
				setDevHealthMsg(message)
			}
		}
		check()
		return () => { cancelled = true }
	}, [])

	const [devBannerDismissed, setDevBannerDismissed] = useState(false)

	const handleRetry = async () => {
		setDevHealthOk(null)
		setDevHealthMsg(null)
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 3000)
			const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal })
			clearTimeout(timeout)
			if (res && res.ok) {
				setDevHealthOk(true)
				setDevHealthMsg(null)
				setDevBannerDismissed(true)
			} else {
				setDevHealthOk(false)
				setDevHealthMsg(`Server responded ${res?.status || 'unknown'}`)
			}
		} catch (err: any) {
			setDevHealthOk(false)
			setDevHealthMsg(err?.message || String(err))
		}
	}

	return (
		<View style={styles.container}>
			<StatusBar barStyle="light-content" translucent backgroundColor="rgba(0,0,0,0)" />
			<View style={styles.content}>
				<View style={styles.logoRow}>
					<Image
						source={require('../../assets/images/bounty-logo.png')}
						style={styles.logoImage}
						resizeMode="contain"
						accessibilityLabel="BOUNTY Logo"
					/>
				</View>
			</View>
			{__DEV__ && devHealthOk === false && !devBannerDismissed ? (
				<View style={styles.devBanner}>
					<Text style={styles.devBannerTitle}>Dev server unreachable</Text>
					<Text style={styles.devBannerMsg}>{`Cannot reach ${API_BASE_URL} — ${devHealthMsg || ''}`}</Text>
					<View style={styles.devBannerActions}>
						<TouchableOpacity onPress={handleRetry} style={styles.devBtn}>
							<Text style={styles.devBtnText}>Retry</Text>
						</TouchableOpacity>
						<TouchableOpacity onPress={() => setDevBannerDismissed(true)} style={[styles.devBtn, styles.devBtnSecondary]}>
							<Text style={[styles.devBtnText, styles.devBtnSecondaryText]}>Continue</Text>
						</TouchableOpacity>
					</View>
				</View>
			) : (
				<Text style={styles.versionText}>Loading…</Text>
			)}
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#15803d', // emerald-700-ish for richer tone vs in-app 600
		alignItems: 'center',
		justifyContent: 'center',
	},
	content: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	logoRow: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	logoImage: {
		width: 280,
		height: 80,
	},
	versionText: {
		position: 'absolute',
		bottom: 32,
		color: 'rgba(255,255,255,0.65)',
		fontSize: 12,
		letterSpacing: 1,
	},
	devBanner: {
		position: 'absolute',
		bottom: 24,
		left: 16,
		right: 16,
		backgroundColor: 'rgba(0,0,0,0.7)',
		padding: 12,
		borderRadius: 8,
		alignItems: 'center',
		justifyContent: 'center',
	},
	devBannerTitle: {
		color: '#fff',
		fontWeight: '700',
		marginBottom: 6,
	},
	devBannerMsg: {
		color: 'rgba(255,255,255,0.9)',
		fontSize: 12,
		textAlign: 'center',
		marginBottom: 8,
	},
	devBannerActions: {
		flexDirection: 'row',
		gap: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	devBtn: {
		paddingVertical: 8,
		paddingHorizontal: 14,
		borderRadius: 6,
		backgroundColor: colors.primary[500],
		marginHorizontal: 6,
	},
	devBtnText: {
		color: '#fff',
		fontWeight: '600',
	},
	devBtnSecondary: {
		backgroundColor: 'transparent',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.2)'
	},
	devBtnSecondaryText: {
		color: 'rgba(255,255,255,0.9)'
	},
});

export default BrandedSplash;
