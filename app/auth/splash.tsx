import React, { useEffect } from 'react';
import { Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
// Note: Native splash visibility is controlled centrally in RootLayout.
// Do NOT call SplashScreen.preventAutoHideAsync()/hideAsync() here to avoid race conditions.

export interface BrandedSplashProps {
	onReady?: () => void; // Optional callback when any internal animation completes
}

export const BrandedSplash: React.FC<BrandedSplashProps> = ({ onReady }) => {
		useEffect(() => {
			// Optionally notify parent after brief delay (animation placeholder)
			const t = setTimeout(() => { onReady?.(); }, 600);
		return () => clearTimeout(t);
	}, [onReady]);

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
			<Text style={styles.versionText}>Loading…</Text>
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
});

export default BrandedSplash;
