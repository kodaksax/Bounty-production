import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedCard } from './ui/animated-card';
import { AnimatedScreen } from './ui/animated-screen';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { BountyEmptyState } from './ui/empty-state';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { useAppTheme } from '../hooks/use-app-theme';

/**
 * Demo screen showcasing emerald theme and micro-interactions
 * This demonstrates all the new animation and theming features
 */
export function ThemeDemoScreen() {
  const insets = useSafeAreaInsets();
  const { colors, spacing } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [switchValue, setSwitchValue] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

  return (
    <AnimatedScreen animationType="fade" duration={300}>
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Theme & Animations Demo</Text>
          <Text style={styles.subtitle}>
            Emerald palette and micro-interactions showcase
          </Text>
        </View>

        {/* Buttons Section */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Buttons with Press Animation</CardTitle>
            <CardDescription>
              Tap buttons to see scale animation and haptic feedback
            </CardDescription>
          </CardHeader>
          <CardContent>
            <View style={styles.buttonGroup}>
              <Button variant="default">Primary Button</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="ghost">Ghost</Button>
            </View>
          </CardContent>
        </Card>

        {/* Animated Card Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Expandable Card</Text>
          <AnimatedCard
            expandable
            expanded={expanded}
            onToggle={setExpanded}
            variant="elevated"
          >
            <Text style={styles.cardText}>
              Tap to {expanded ? 'collapse' : 'expand'} this card
            </Text>
            {expanded && (
              <View style={styles.expandedContent}>
                <Text style={styles.expandedText}>
                  🎉 This content appears with a smooth animation!
                </Text>
                <Text style={styles.expandedText}>
                  The card uses LayoutAnimation for fluid expansion.
                </Text>
              </View>
            )}
          </AnimatedCard>
        </View>

        {/* Badges Section */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Badges with Emerald Theme</CardTitle>
            <CardDescription>
              Various badge styles using the emerald color palette
            </CardDescription>
          </CardHeader>
          <CardContent>
            <View style={styles.badgeGroup}>
              <Badge variant="default">Default</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="destructive">Error</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="secondary">Secondary</Badge>
            </View>
          </CardContent>
        </Card>

        {/* Input Section */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Input Fields</CardTitle>
            <CardDescription>
              Emerald-themed inputs with glass morphism
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Default input"
              style={{ marginBottom: spacing.md }}
            />
            <Input
              placeholder="Outline variant"
              variant="outline"
            />
          </CardContent>
        </Card>

        {/* Switch Section */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Switch with Animation</CardTitle>
            <CardDescription>
              Animated toggle with emerald accent color
            </CardDescription>
          </CardHeader>
          <CardContent>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Enable feature</Text>
              <Switch
                checked={switchValue}
                onCheckedChange={setSwitchValue}
              />
            </View>
          </CardContent>
        </Card>

        {/* Pressable Card Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pressable Cards</Text>
          <AnimatedCard
            pressable
            variant="elevated"
            onPress={() => console.log('Card pressed!')}
            style={{ marginBottom: spacing.md }}
          >
            <Text style={styles.cardText}>Tap this card</Text>
            <Text style={styles.cardSubtext}>
              See the subtle press animation
            </Text>
          </AnimatedCard>
          
          <AnimatedCard
            pressable
            variant="default"
            onPress={() => console.log('Card pressed!')}
          >
            <Text style={styles.cardText}>Another pressable card</Text>
            <Text style={styles.cardSubtext}>
              Default variant with less elevation
            </Text>
          </AnimatedCard>
        </View>

        {/* Empty State Section */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Empty States</CardTitle>
            <CardDescription>
              Animated empty states with helpful messaging
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onPress={() => setShowEmpty(!showEmpty)}
              style={{ marginBottom: spacing.lg }}
            >
              {showEmpty ? 'Hide' : 'Show'} Empty State
            </Button>
            
            {showEmpty && (
              <BountyEmptyState onClearFilter={() => setShowEmpty(false)} />
            )}
          </CardContent>
        </Card>

        {/* Color Palette Reference */}
        <Card style={styles.section}>
          <CardHeader>
            <CardTitle>Emerald Color Palette</CardTitle>
            <CardDescription>
              Primary brand colors used throughout the app
            </CardDescription>
          </CardHeader>
          <CardContent>
            <View style={styles.colorGrid}>
              <View style={styles.colorItem}>
                <View style={[styles.colorSwatch, { backgroundColor: colors.primary[600] }]} />
                <Text style={styles.colorLabel}>Emerald 600</Text>
                <Text style={styles.colorCode}>#00912C</Text>
              </View>
              <View style={styles.colorItem}>
                <View style={[styles.colorSwatch, { backgroundColor: colors.primary[700] }]} />
                <Text style={styles.colorLabel}>Emerald 700</Text>
                <Text style={styles.colorCode}>#007423</Text>
              </View>
              <View style={styles.colorItem}>
                <View style={[styles.colorSwatch, { backgroundColor: colors.primary[800] }]} />
                <Text style={styles.colorLabel}>Emerald 800</Text>
                <Text style={styles.colorCode}>#00571a</Text>
              </View>
            </View>
          </CardContent>
        </Card>
      </ScrollView>
    </AnimatedScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  header: {
    padding: 20,
    paddingTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 254, 245, 0.7)',
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 12,
    marginLeft: 16,
  },
  buttonGroup: {
    gap: 12,
  },
  badgeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 15,
    color: '#fffef5',
  },
  cardText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 4,
  },
  cardSubtext: {
    fontSize: 14,
    color: 'rgba(255, 254, 245, 0.7)',
  },
  expandedContent: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 145, 44, 0.2)',
  },
  expandedText: {
    fontSize: 14,
    color: 'rgba(255, 254, 245, 0.8)',
    marginBottom: 8,
  },
  colorGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  colorItem: {
    flex: 1,
    alignItems: 'center',
  },
  colorSwatch: {
    width: '100%',
    height: 60,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 254, 245, 0.1)',
  },
  colorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 2,
  },
  colorCode: {
    fontSize: 11,
    color: 'rgba(255, 254, 245, 0.6)',
    fontFamily: 'monospace',
  },
});
