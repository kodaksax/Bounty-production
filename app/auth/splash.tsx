import * as ExpoSplash from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE_URL } from '../../lib/config/api';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
// Centralized helpers: RootLayout (and any other callers) should use these
// to show/hide the native splash. Keeping them here ensures "use splash.tsx
// for any splash things" without scattering imports of expo-splash-screen.

export async function showNativeSplash() {
	try {
		await ExpoSplash.preventAutoHideAsync();
	} catch {
		// ignore if already prevented or not applicable
	}
}

export async function hideNativeSplashSafely() {
	try {
		await ExpoSplash.hideAsync();
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
					<View style={styles.targetCircleOuter}>
						<View style={styles.targetCircleInner} />
						<View style={styles.crosshairHorizontal} />
						<View style={styles.crosshairVertical} />
					</View>
								<Text accessibilityRole="header" style={styles.wordmark}>BOUNTY</Text>
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
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	targetCircleOuter: {
		width: 70,
		height: 70,
		borderRadius: 35,
		borderWidth: 5,
		borderColor: '#ffffff',
		alignItems: 'center',
		justifyContent: 'center',
	},
	targetCircleInner: {
		width: 22,
		height: 22,
		borderRadius: 11,
		borderWidth: 4,
		borderColor: '#ffffff',
	},
	crosshairHorizontal: {
		position: 'absolute',
		height: 5,
		width: 60,
		backgroundColor: '#ffffff',
	},
	crosshairVertical: {
		position: 'absolute',
		width: 5,
		height: 60,
		backgroundColor: '#ffffff',
	},
	wordmark: {
		fontSize: 46,
		color: '#ffffff',
		fontWeight: '900',
		letterSpacing: 2,
		fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-black', default: 'System' }),
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
		backgroundColor: '#10b981',
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
