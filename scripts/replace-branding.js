const fs = require('fs');
const path = require('path');

// Comprehensive list of files to update
const updates = [
    // Auth screens
    {
        file: 'app/auth/reset-password.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-40' }
        ]
    },
    {
        file: 'app/auth/update-password.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-40' }
        ]
    },
    // Onboarding screens
    {
        file: 'app/onboarding/carousel.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-onboarding-28' }
        ]
    },
    {
        file: 'app/onboarding/username.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-onboarding-28' }
        ]
    },
    {
        file: 'app/onboarding/details.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-onboarding-20' }
        ]
    },
    {
        file: 'app/onboarding/phone.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-onboarding-20' }
        ]
    },
    {
        file: 'app/onboarding/done.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-onboarding-24' }
        ]
    },
    {
        file: 'app/onboarding/email-confirmation.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-text-only' }
        ]
    },
    // Main app screens
    {
        file: 'app/tabs/bounty-app.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-icon-only' }
        ]
    },
    {
        file: 'app/tabs/profile-screen.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-icon-only-20' }
        ]
    },
    {
        file: 'app/tabs/messenger-screen.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-text-only' }
        ]
    },
    {
        file: 'app/tabs/postings-screen.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-icon-only' }
        ]
    },
    {
        file: 'app/tabs/wallet-screen.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-icon-only' }
        ]
    },
    {
        file: 'app/profile/[userId].tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'logo-header-icon-only-20' }
        ]
    },
    // Bottom navigation
    {
        file: 'components/ui/bottom-nav.tsx',
        patterns: [
            { type: 'import-image' },
            { type: 'icon-center-nav' }
        ]
    }
];

// Import pattern templates
const importPatterns = {
    'import-image': {
        // Add Image to existing imports from react-native
        regex: /from 'react-native'/g,
        check: (content) => !content.includes("import { Image") && !content.includes(", Image,"),
        replace: (content) => {
            return content.replace(
                /import \{([^}]+)\} from 'react-native'/,
                (match, imports) => {
                    if (imports.includes('Image')) return match;
                    const cleanImports = imports.trim();
                    return `import { Image, ${cleanImports} } from 'react-native'`;
                }
            );
        }
    }
};

// Replacement pattern templates
const patterns = {
    'logo-header-40': {
        search: `            <MaterialIcons name="gps-fixed" size={40} color="#fff" />
            <Text className="text-white font-extrabold text-3xl tracking-widest ml-2">BOUNTY</Text>`,
        replace: `            <Image 
              source={require('../../assets/images/bounty-logo.png')}
              style={{ width: 220, height: 60 }}
              resizeMode="contain"
            />`
    },
    'logo-onboarding-28': {
        search: `        <MaterialIcons name="gps-fixed" size={28} color="#a7f3d0" />
          <Text style={styles.brandingText}>BOUNTY</Text>`,
        replace: `        <Image 
          source={require('../../assets/images/bounty-logo.png')}
          style={{ width: 200, height: 55, tintColor: '#a7f3d0' }}
          resizeMode="contain"
        />`
    },
    'logo-onboarding-20': {
        search: `            <MaterialIcons name="gps-fixed" size={20} color="#a7f3d0" />
            <Text style={styles.brandingText}>BOUNTY</Text>`,
        replace: `            <Image 
              source={require('../../assets/images/bounty-logo.png')}
              style={{ width: 180, height: 50, tintColor: '#a7f3d0' }}
              resizeMode="contain"
            />`
    },
    'logo-onboarding-24': {
        search: `        <MaterialIcons name="gps-fixed" size={24} color="#a7f3d0" />
        <Text style={styles.brandingText}>BOUNTY</Text>`,
        replace: `        <Image 
          source={require('../../assets/images/bounty-logo.png')}
          style={{ width: 180, height: 50, tintColor: '#a7f3d0' }}
          resizeMode="contain"
        />`
    },
    'logo-text-only': {
        search: `<Text style={styles.brandingText}>BOUNTY</Text>`,
        replace: `<Image 
          source={require('../../assets/images/bounty-logo.png')}
          style={{ width: 140, height: 40 }}
          resizeMode="contain"
        />`
    },
    'logo-header-icon-only': {
        search: `              name="gps-fixed" 
              size={HEADER_LAYOUT.iconSize} 
              color="#ffffff"
              accessibilityElementsHidden={true}
            />
            <Animated.Text`,
        replace: `              name="gps-fixed" 
              size={1} 
              color="transparent"
              accessibilityElementsHidden={true}
              style={{ width: 0, height: 0, opacity: 0 }}
            />
            <Image 
              source={require('../../assets/images/bounty-logo.png')}
              style={{ width: 160, height: 44, marginLeft: -8 }}
              resizeMode="contain"
              accessibilityLabel="BOUNTY"
            />
            <Animated.Text
              style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}`
    },
    'logo-header-icon-only-20': {
        search: `            name="gps-fixed" 
            size={20} 
            color="#ffffff"
          />
            <Text style={styles.headerTitle}>BOUNTY</Text>`,
        replace: `            name="gps-fixed" 
            size={1} 
            color="transparent"
            style={{ width: 0, height: 0, opacity: 0 }}
          />
            <Image 
              source={require('../../assets/images/bounty-logo.png')}
              style={{ width: 140, height: 38 }}
              resizeMode="contain"
              accessibilityLabel="BOUNTY"
            />`
    },
    'icon-center-nav': {
        search: `                name="gps-fixed" 
                color={activeScreen === "bounty" ? "#fffef5" : "#d1fae5"} 
                size={CENTER_ICON_SIZE}`,
        replace: `                name="gps-fixed" 
                color="transparent"
                size={1}
                style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
              />
              <Image 
                source={require('../../assets/images/bounty-icon.png')}
                style={{ width: 36, height: 36 }}
                resizeMode="contain"`
    }
};

const rootDir = path.join(__dirname, '..');

let updatedCount = 0;
let skippedCount = 0;

updates.forEach(({ file, patterns: filePatterns }) => {
    const filePath = path.join(rootDir, file);

    if (!fs.existsSync(filePath)) {
        console.warn(`⚠ File not found: ${file}`);
        skippedCount++;
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    filePatterns.forEach(pattern => {
        const patternDef = patterns[pattern.type] || importPatterns[pattern.type];

        if (!patternDef) {
            console.warn(`⚠ Unknown pattern type: ${pattern.type}`);
            return;
        }

        // Handle import patterns differently
        if (pattern.type === 'import-image') {
            if (patternDef.check && patternDef.check(content)) {
                content = patternDef.replace(content);
                modified = true;
            }
        } else {
            // Handle replacement patterns
            if (content.includes(patternDef.search)) {
                content = content.replace(patternDef.search, patternDef.replace);
                modified = true;
            }
        }
    });

    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✓ Updated: ${file}`);
        updatedCount++;
    } else {
        console.log(`- No changes: ${file}`);
        skippedCount++;
    }
});

console.log(`\n=== Summary ===`);
console.log(`✓ Updated: ${updatedCount} files`);
console.log(`- Skipped: ${skippedCount} files`);
console.log(`\nBranding replacement complete!`);
