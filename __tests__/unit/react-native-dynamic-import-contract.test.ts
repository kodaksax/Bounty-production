import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '../../');
const sourceDirs = ['app', 'components', 'hooks', 'lib', 'providers'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

// Metro resolves `import('react-native')` with metroImportAll, which reads every
// export. On iOS that includes the deprecated PushNotificationIOS getter, which
// throws a NativeEventEmitter error. Jest's Babel interop does not read getters,
// so only a source check catches this.
describe('react-native imports', () => {
  it('never loads react-native with a dynamic import', () => {
    const offenders = sourceDirs
      .flatMap(dir => sourceFiles(path.join(root, dir)))
      .filter(file => /import\(\s*['"]react-native['"]\s*\)/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(root, file));

    expect(offenders).toEqual([]);
  });
});
