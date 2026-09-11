/**
 * PdfPreview
 *
 * Renders a PDF the way the file itself looks once downloaded: white pages on a
 * neutral viewer backdrop, never tinted by the app theme. Previously portfolio
 * PDFs were handed to <OptimizedImage>, which cannot decode a PDF — the result
 * was an empty box showing the app's own background through it.
 *
 * Platform strategy:
 * - iOS:     WKWebView renders PDFs natively (vector, crisp pinch-zoom).
 * - Android: Android's WebView has no PDF renderer, so we rasterize with pdf.js.
 *            pdf.js canvases are transparent where the page has no painted
 *            background, so every page canvas is explicitly filled white first —
 *            that transparency is exactly what let the app background show
 *            through before.
 * - Web:     the browser's built-in viewer via an <iframe>.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { openUrlInBrowser } from '../../lib/utils/browser';

/** Backdrop used by system PDF viewers (Preview, Chrome) around the page. */
const VIEWER_BACKDROP = '#525659';
/** The page itself is always white — this is the "downloaded look" the user sees. */
const PAGE_COLOR = '#FFFFFF';

const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/**
 * Largest file we will pull into memory to rasterize on Android. Base64 inflates
 * a file by ~33% and the string crosses the RN bridge, so keep this modest and
 * fall back to the system viewer for anything bigger.
 */
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

export interface PdfSourceLike {
  mimeType?: string | null;
  name?: string | null;
  url?: string | null;
  uri?: string | null;
}

/** True when an attachment/portfolio item should be rendered as a PDF. */
export function isPdfSource(item?: PdfSourceLike | null): boolean {
  if (!item) return false;
  if (item.mimeType && item.mimeType.toLowerCase().includes('pdf')) return true;
  const candidates = [item.name, item.url, item.uri];
  return candidates.some(value => !!value && /\.pdf(?:$|[?#])/i.test(value));
}

function buildViewerHtml(base64: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4, user-scalable=yes" />
<style>
  html, body { margin: 0; padding: 0; background: ${VIEWER_BACKDROP}; }
  #pages { display: flex; flex-direction: column; align-items: center; padding: 10px 8px; }
  canvas { background: ${PAGE_COLOR}; display: block; margin-bottom: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.45); }
  #error { display: none; color: #fff; font: 14px -apple-system, system-ui, sans-serif; padding: 24px; text-align: center; }
</style>
</head>
<body>
<div id="pages"></div>
<div id="error"></div>
<script src="${PDFJS_CDN}/pdf.min.js"></script>
<script>
(function () {
  var DATA = "${base64}";
  function post(message) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch (e) {}
  }
  function fail(message) {
    var node = document.getElementById('error');
    node.style.display = 'block';
    node.textContent = message;
    post({ type: 'error', message: message });
  }
  if (!window.pdfjsLib) {
    fail('Unable to load the PDF viewer.');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_CDN}/pdf.worker.min.js';

  var binary = atob(DATA);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
    var container = document.getElementById('pages');
    var cssWidth = Math.max(document.documentElement.clientWidth - 16, 120);
    // Cap the backing-store scale: 2x is sharp on every phone without making
    // multi-page documents blow past the WebView's memory budget.
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var chain = Promise.resolve();
    for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      (function (n) {
        chain = chain.then(function () {
          return pdf.getPage(n).then(function (page) {
            var unscaled = page.getViewport({ scale: 1 });
            var scale = cssWidth / unscaled.width;
            var viewport = page.getViewport({ scale: scale * dpr });
            var canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
            canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
            var ctx = canvas.getContext('2d');
            // Paint the page white before rendering: a PDF page with no drawn
            // background is transparent, and transparency here means "whatever
            // is behind the WebView", i.e. the app's background color.
            ctx.fillStyle = '${PAGE_COLOR}';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            container.appendChild(canvas);
            return page.render({ canvasContext: ctx, viewport: viewport, background: '${PAGE_COLOR}' }).promise;
          });
        });
      })(pageNumber);
    }
    return chain.then(function () { post({ type: 'loaded', pages: pdf.numPages }); });
  }).catch(function () {
    fail('Unable to display this PDF.');
  });
})();
</script>
</body>
</html>`;
}

/** Download (or read) the PDF and return it base64-encoded for pdf.js. */
async function readPdfAsBase64(uri: string): Promise<string> {
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    const local = new File(uri);
    const size = local.size ?? 0;
    if (size > MAX_INLINE_BYTES) throw new Error('PDF_TOO_LARGE');
    return await local.base64();
  }

  if (uri.startsWith('data:')) {
    const commaIndex = uri.indexOf(',');
    if (commaIndex === -1 || !/;base64/i.test(uri.slice(0, commaIndex))) {
      throw new Error('UNSUPPORTED_DATA_URI');
    }
    return uri.slice(commaIndex + 1);
  }

  const destination = new File(Paths.cache, `pdf-preview-${Date.now()}.pdf`);
  const downloaded = await File.downloadFileAsync(uri, destination);
  try {
    const size = downloaded.size ?? 0;
    if (size > MAX_INLINE_BYTES) throw new Error('PDF_TOO_LARGE');
    return await downloaded.base64();
  } finally {
    try {
      downloaded.delete();
    } catch {
      /* cache file, best effort */
    }
  }
}

export interface PdfPreviewProps {
  /** Remote URL or local file:// URI of the PDF. */
  uri: string;
  /** File name, used for the fallback message. */
  name?: string;
  style?: StyleProp<ViewStyle>;
  /** Rounded corners to match the surrounding card. */
  borderRadius?: number;
}

export function PdfPreview({ uri, name, style, borderRadius = 8 }: PdfPreviewProps) {
  const usesPdfJs = Platform.OS === 'android';
  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!usesPdfJs) return;
    let cancelled = false;
    setHtml(null);
    setError(null);
    setIsLoading(true);

    (async () => {
      try {
        const base64 = await readPdfAsBase64(uri);
        if (cancelled || !isMounted.current) return;
        setHtml(buildViewerHtml(base64));
      } catch (e: any) {
        console.error('[PdfPreview] failed to prepare PDF:', e);
        if (cancelled || !isMounted.current) return;
        setIsLoading(false);
        setError(
          e?.message === 'PDF_TOO_LARGE'
            ? 'This PDF is too large to preview here.'
            : 'Unable to display this PDF.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uri, usesPdfJs]);

  const canOpenExternally = /^https?:\/\//i.test(uri);

  const containerStyle = useMemo(
    () => [styles.container, { borderRadius }, style],
    [borderRadius, style]
  );

  if (error) {
    return (
      <View style={containerStyle}>
        <View style={styles.fallback}>
          <MaterialIcons name="picture-as-pdf" size={56} color="#ef4444" />
          <Text style={styles.fallbackTitle} numberOfLines={2}>
            {name || 'PDF document'}
          </Text>
          <Text style={styles.fallbackText}>{error}</Text>
          {canOpenExternally && (
            <TouchableOpacity
              style={styles.fallbackButton}
              onPress={() => openUrlInBrowser(uri)}
              accessibilityRole="button"
              accessibilityLabel="Open PDF outside the app"
            >
              <Text style={styles.fallbackButtonText}>Open PDF</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={containerStyle}>
        {React.createElement('iframe', {
          src: uri,
          title: name || 'PDF preview',
          style: { width: '100%', height: '100%', border: 'none', backgroundColor: PAGE_COLOR },
        })}
      </View>
    );
  }

  const source = usesPdfJs ? (html ? { html } : null) : { uri };

  return (
    <View style={containerStyle}>
      {source && (
        <WebView
          source={source as any}
          originWhitelist={['*']}
          style={styles.webview}
          // Keep the white page visible while the document paints instead of
          // flashing the themed background behind the WebView.
          containerStyle={styles.webviewContainer}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={uri.startsWith('file://') ? uri : undefined}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          scalesPageToFit
          onLoadEnd={() => {
            // pdf.js reports completion itself via postMessage; for the native
            // iOS viewer, load end is the only signal we get.
            if (!usesPdfJs) setIsLoading(false);
          }}
          onMessage={event => {
            try {
              const payload = JSON.parse(event.nativeEvent.data);
              if (payload?.type === 'loaded') setIsLoading(false);
              if (payload?.type === 'error') {
                setIsLoading(false);
                setError(payload.message || 'Unable to display this PDF.');
              }
            } catch {
              /* ignore non-JSON messages */
            }
          }}
          onError={syntheticEvent => {
            console.error('[PdfPreview] WebView error:', syntheticEvent.nativeEvent);
            setIsLoading(false);
            setError('Unable to display this PDF.');
          }}
        />
      )}
      {isLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#9CA3AF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: VIEWER_BACKDROP,
  },
  webview: {
    flex: 1,
    backgroundColor: VIEWER_BACKDROP,
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: VIEWER_BACKDROP,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VIEWER_BACKDROP,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  fallbackText: {
    color: '#D1D5DB',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  fallbackButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#059669',
  },
  fallbackButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default PdfPreview;
