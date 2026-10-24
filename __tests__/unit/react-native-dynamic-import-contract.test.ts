import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const root = path.join(__dirname, '../../');
const sourceDirs = ['app', 'components', 'hooks', 'lib', 'providers'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function staticStringValue(node: ts.Expression): string | undefined {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return staticStringValue(node.expression);
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce<string | undefined>(
      (value, span) => {
        const expression = staticStringValue(span.expression);
        return value === undefined || expression === undefined
          ? undefined
          : value + expression + span.literal.text;
      },
      node.head.text
    );
  }
  return undefined;
}

function hasDynamicImportOf(source: string, moduleName: string): boolean {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      staticStringValue(node.arguments[0]) === moduleName
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

// Metro resolves `import('react-native')` with metroImportAll, which reads every
// export. On iOS that includes the deprecated PushNotificationIOS getter, which
// throws a NativeEventEmitter error. Jest's Babel interop does not read getters,
// so only a source check catches this.
describe('react-native imports', () => {
  it.each([
    "import('react-native')",
    "import(/* comment */ 'react-native')",
    'import(`react-native`)',
    "import('react-' + 'native')",
    "import(`react-${'native'}`)",
    "import(('react-native' as const))",
  ])('recognizes equivalent dynamic import syntax: %s', source => {
    expect(hasDynamicImportOf(source, 'react-native')).toBe(true);
  });

  it('does not treat a different module as react-native', () => {
    expect(hasDynamicImportOf("import('react-native-web')", 'react-native')).toBe(false);
  });

  it('never loads react-native with a dynamic import', () => {
    const offenders = sourceDirs
      .flatMap(dir => sourceFiles(path.join(root, dir)))
      .filter(file => hasDynamicImportOf(fs.readFileSync(file, 'utf8'), 'react-native'))
      .map(file => path.relative(root, file));

    expect(offenders).toEqual([]);
  });
});
