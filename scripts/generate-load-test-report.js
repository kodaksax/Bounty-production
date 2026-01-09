/**
 * k6 Configuration - HTML Summary Reporter
 * 
 * This script generates an HTML summary report after load tests.
 * Can be used with any k6 test by adding: --out json=results.json
 * Then run: node scripts/generate-load-test-report.js results.json
 */

const fs = require('fs');
const path = require('path');

// Check if result file is provided
if (process.argv.length < 3) {
  console.error('Usage: node generate-load-test-report.js <k6-results.json>');
  process.exit(1);
}

const resultFile = process.argv[2];

if (!fs.existsSync(resultFile)) {
  console.error(`Error: File not found: ${resultFile}`);
  process.exit(1);
}

// Read the k6 JSON results
const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'));

// Extract metrics
const metrics = results.metrics || {};

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatRate(rate) {
  return `${(rate * 100).toFixed(2)}%`;
}

function formatThroughput(count, duration) {
  return `${(count / (duration / 1000)).toFixed(2)}/s`;
}

// Generate HTML report
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>k6 Load Test Results</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f5f5;
            padding: 20px;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 30px;
        }
        h1 {
            color: #059669;
            margin-bottom: 10px;
            font-size: 2em;
        }
        .timestamp {
            color: #666;
            margin-bottom: 30px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: #f9fafb;
            border-left: 4px solid #059669;
            padding: 20px;
            border-radius: 4px;
        }
        .metric-card.warning {
            border-left-color: #f59e0b;
        }
        .metric-card.error {
            border-left-color: #ef4444;
        }
        .metric-label {
            font-size: 0.875rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .metric-value {
            font-size: 2rem;
            font-weight: 600;
            color: #111;
        }
        .metric-subvalue {
            font-size: 0.875rem;
            color: #666;
            margin-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        th {
            background: #f9fafb;
            font-weight: 600;
            color: #374151;
        }
        tr:hover {
            background: #f9fafb;
        }
        .status-pass {
            color: #059669;
            font-weight: 600;
        }
        .status-fail {
            color: #ef4444;
            font-weight: 600;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #666;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 k6 Load Test Results</h1>
        <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>

        <div class="summary-grid">
            <div class="metric-card">
                <div class="metric-label">Response Time (p95)</div>
                <div class="metric-value">${formatDuration(metrics.http_req_duration?.values?.['p(95)'] || 0)}</div>
                <div class="metric-subvalue">Target: < 500ms</div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Error Rate</div>
                <div class="metric-value">${formatRate(metrics.http_req_failed?.values?.rate || 0)}</div>
                <div class="metric-subvalue">Target: < 1%</div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Total Requests</div>
                <div class="metric-value">${metrics.http_reqs?.values?.count || 0}</div>
                <div class="metric-subvalue">Throughput: ${formatThroughput(metrics.http_reqs?.values?.count || 0, metrics.http_req_duration?.values?.avg || 1000)}</div>
            </div>

            <div class="metric-card">
                <div class="metric-label">Virtual Users (Max)</div>
                <div class="metric-value">${metrics.vus_max?.values?.max || 0}</div>
                <div class="metric-subvalue">Concurrent load</div>
            </div>
        </div>

        <h2>Response Time Distribution</h2>
        <table>
            <thead>
                <tr>
                    <th>Metric</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Average</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.avg || 0)}</td>
                </tr>
                <tr>
                    <td>Median (p50)</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.['p(50)'] || 0)}</td>
                </tr>
                <tr>
                    <td>90th Percentile</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.['p(90)'] || 0)}</td>
                </tr>
                <tr>
                    <td>95th Percentile</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.['p(95)'] || 0)}</td>
                </tr>
                <tr>
                    <td>99th Percentile</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.['p(99)'] || 0)}</td>
                </tr>
                <tr>
                    <td>Maximum</td>
                    <td>${formatDuration(metrics.http_req_duration?.values?.max || 0)}</td>
                </tr>
            </tbody>
        </table>

        <h2>Threshold Results</h2>
        <table>
            <thead>
                <tr>
                    <th>Threshold</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>http_req_duration p(95) < 500ms</td>
                    <td class="${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 500 ? 'status-pass' : 'status-fail'}">
                        ${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 500 ? '✓ PASS' : '✗ FAIL'}
                    </td>
                </tr>
                <tr>
                    <td>http_req_failed rate < 1%</td>
                    <td class="${(metrics.http_req_failed?.values?.rate || 0) < 0.01 ? 'status-pass' : 'status-fail'}">
                        ${(metrics.http_req_failed?.values?.rate || 0) < 0.01 ? '✓ PASS' : '✗ FAIL'}
                    </td>
                </tr>
            </tbody>
        </table>

        <div class="footer">
            Generated by k6 Load Testing Framework<br>
            BountyExpo Performance Testing Suite
        </div>
    </div>
</body>
</html>
`;

// Write HTML report
const outputFile = resultFile.replace('.json', '.html');
fs.writeFileSync(outputFile, html);

console.log(`✅ HTML report generated: ${outputFile}`);
console.log(`📊 Open the report in your browser to view detailed results.`);
