const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'static.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const reportPath = path.join(__dirname, 'test-report.html');
const htmlFiles = [
  path.join(root, 'index.html'),
  ...fs.readdirSync(path.join(root, 'src'))
    .filter((file) => file.endsWith('.html'))
    .map((file) => path.join(root, 'src', file)),
];

const checks = [
  {
    name: 'Pages workflow deploys the repository root',
    run: () => {
      assert.match(workflow, /uses:\s*actions\/upload-pages-artifact@v3/);
      assert.match(workflow, /^\s+path:\s*['"]?\.\s*['"]?\s*$/m);
      assert.match(workflow, /uses:\s*actions\/deploy-pages@v5/);
    },
  },
  {
    name: 'Deployment waits for the test job',
    run: () => {
      assert.match(workflow, /^\s+test:\s*$/m);
      assert.match(workflow, /^\s+deploy:\s*\n\s+needs:\s*test\s*$/m);
    },
  },
  {
    name: 'Published root contains the homepage and custom-domain file',
    run: () => {
      assert.ok(fs.existsSync(path.join(root, 'index.html')));
      assert.ok(fs.existsSync(path.join(root, 'CNAME')));
    },
  },
  {
    name: 'Every local HTML link and asset points to a published file',
    run: () => {
      const missing = [];

      for (const htmlFile of htmlFiles) {
        const html = fs.readFileSync(htmlFile, 'utf8');
        const attributes = html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi);

        for (const [, value] of attributes) {
          if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
            continue;
          }

          const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
          const target = pathname
            ? path.resolve(path.dirname(htmlFile), pathname)
            : htmlFile;
          const targetWithIndex = path.extname(target) ? target : path.join(target, 'index.html');

          if (!fs.existsSync(target) && !fs.existsSync(targetWithIndex)) {
            missing.push(`${path.relative(root, htmlFile)} -> ${value}`);
          }
        }
      }

      assert.deepEqual(missing, []);
    },
  },
].map((check) => ({ ...check, status: 'not-run' }));

function escapeHtml(value) {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

for (const check of checks) {
  test(check.name, () => {
    try {
      check.run();
      check.status = 'passed';
    } catch (error) {
      check.status = 'failed';
      throw error;
    }
  });
}

after(() => {
  const completed = checks.filter((check) => check.status !== 'not-run').length;
  const passed = checks.filter((check) => check.status === 'passed').length;
  const failed = checks.filter((check) => check.status === 'failed').length;
  const coverage = Math.round((completed / checks.length) * 100);
  const overallStatus = failed > 0 ? 'failed' : completed < checks.length ? 'incomplete' : 'passed';
  const statusLabels = {
    passed: 'PASS',
    failed: 'FAIL',
    'not-run': 'NOT RUN',
    incomplete: 'INCOMPLETE',
  };
  const rows = checks.map((check) => `
        <li class="check ${check.status}">
          <span class="indicator" aria-hidden="true"></span>
          <span class="check-name">${escapeHtml(check.name)}</span>
          <strong class="status">${statusLabels[check.status]}</strong>
        </li>`).join('');

  const report = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Static Site Test Report</title>
  <style>
    :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #202124; background: #f5f7fa; }
    body { max-width: 760px; margin: 48px auto; padding: 0 20px; }
    main { padding: 28px; border: 1px solid #dfe3e8; border-radius: 12px; background: white; }
    h1 { margin-top: 0; }
    .summary { display: flex; gap: 24px; flex-wrap: wrap; margin: 20px 0; }
    .summary strong { font-size: 1.25rem; }
    progress { width: 100%; height: 16px; accent-color: #188038; }
    ul { list-style: none; padding: 0; margin: 24px 0 0; }
    .check { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid #e8eaed; }
    .check-name { flex: 1; }
    .indicator { width: 12px; height: 12px; flex: none; border-radius: 50%; background: #9aa0a6; }
    .passed .indicator { background: #188038; }
    .failed .indicator { background: #d93025; }
    .not-run .indicator { background: #f9ab00; }
    .passed .status { color: #137333; }
    .failed .status { color: #c5221f; }
    .not-run .status { color: #9a6700; }
    .note { color: #5f6368; font-size: .9rem; }
    .overall.failed { color: #c5221f; }
    .overall.incomplete { color: #9a6700; }
    .overall.passed { color: #137333; }
  </style>
</head>
<body>
  <main>
    <h1>Static Site Test Report</h1>
    <p class="note">Checklist coverage means the share of configured workflow/site requirements that ran; it is not source-code line coverage.</p>
    <div class="summary">
      <span>Checklist coverage <strong>${coverage}%</strong></span>
      <span>Passed <strong>${passed}</strong></span>
      <span>Failed <strong>${failed}</strong></span>
    </div>
    <progress value="${coverage}" max="100" aria-label="Checklist coverage">${coverage}%</progress>
    <ul>${rows}
    </ul>
    <p class="overall ${overallStatus}">Overall result: ${statusLabels[overallStatus]}</p>
  </main>
</body>
</html>
`;

  fs.writeFileSync(reportPath, report);
});
