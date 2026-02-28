# Codecov Integration Setup Guide

This guide explains how to set up Codecov integration for the BOUNTYExpo project to track code coverage across pull requests and commits.

## Overview

Codecov is already integrated into the CI pipeline via `.github/workflows/ci.yml`. However, to use it effectively, you need to configure the Codecov token in GitHub repository secrets.

## Prerequisites

1. A Codecov account (free for open-source projects)
2. Repository admin access to add secrets
3. CI workflow already configured (✅ Done)

## Setup Steps

### 1. Create Codecov Account and Add Repository

1. **Sign up for Codecov**
   - Visit https://about.codecov.io/
   - Click "Sign up" and authenticate with GitHub
   - Grant Codecov access to your repositories

2. **Add Your Repository**
   - Once logged in, click "Add new repository"
   - Find `<your-username>/<your-repo-name>` (e.g., `kodaksax/Bounty-production`) in the list
   - Click "Setup repo"

3. **Get Your Upload Token**
   - After adding the repo, Codecov will display an upload token
   - Copy this token (it should look like: `a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6`)
   - Keep this token secure - it's used to upload coverage reports

### 2. Add Codecov Token to GitHub Secrets

1. **Navigate to Repository Settings**
   ```
   Repository → Settings → Secrets and variables → Actions
   ```

2. **Create New Secret**
   - Click "New repository secret"
   - Name: `CODECOV_TOKEN`
   - Value: Paste the token from Codecov
   - Click "Add secret"

### 3. Verify Integration

1. **Trigger CI Workflow**
   - Push a commit or create a pull request
   - Wait for CI to complete

2. **Check Codecov Dashboard**
   - Visit https://app.codecov.io/gh/<your-username>/<your-repo-name>
   - You should see coverage reports appearing
   - Initial upload may take a few minutes

3. **Check PR Comments**
   - On pull requests, Codecov will automatically comment with:
     - Coverage percentage change
     - Files with changed coverage
     - Coverage trends

## Current Configuration

The CI workflow (`.github/workflows/ci.yml`) includes:

```yaml
- name: Generate coverage report
  run: npm run test:coverage
  env:
    NODE_ENV: test

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@5c47607acb93fed5485fdbf7232e8a31425f672a # v4.6.0
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    file: ./coverage/coverage-final.json
    flags: unittests
    name: codecov-umbrella
    fail_ci_if_error: false
```

**Security Note:** The codecov action is pinned to a specific commit SHA (`5c47607acb93fed5485fdbf7232e8a31425f672a`) rather than a mutable tag (`v4`). This reduces supply-chain risk by ensuring only audited, immutable action code runs in the CI pipeline. When updating, always verify the new commit SHA corresponds to a trusted release.

### Coverage Thresholds

Coverage thresholds are configured in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70,
  },
}
```

## Codecov Configuration File

You can create a `.codecov.yml` file in the repository root for advanced configuration:

```yaml
# .codecov.yml
coverage:
  status:
    project:
      default:
        target: 70%
        threshold: 1%
        if_ci_failed: error
    patch:
      default:
        target: 70%
        threshold: 1%

comment:
  layout: "reach, diff, flags, files"
  behavior: default
  require_changes: false
  require_base: false
  require_head: true

ignore:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.js"
  - "**/*.test.jsx"
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/*.d.ts"
  - "**/declarations/**"
  - "**/stubs/**"
  - "**/examples/**"
  - "jest.setup.js"
  - "jest.config.js"
```

Create this file to customize Codecov behavior.

## Features

### 1. Coverage Reports on PRs

Codecov automatically comments on pull requests with:
- Overall coverage change (e.g., "+2.5%")
- Per-file coverage changes
- Uncovered lines in new code

### 2. Coverage Badges

Add a coverage badge to your README.md:

```markdown
[![codecov](https://codecov.io/gh/<your-username>/<your-repo-name>/branch/main/graph/badge.svg)](https://codecov.io/gh/<your-username>/<your-repo-name>)
```

### 3. Sunburst Diagram

Codecov provides a visual sunburst diagram showing coverage by directory and file.

### 4. Coverage Trends

Track coverage over time to ensure code quality doesn't degrade.

## Troubleshooting

### Token Not Working

**Symptom:** CI fails with "Could not upload coverage report"

**Solution:**
1. Verify token is copied correctly (no extra spaces)
2. Check that secret name is exactly `CODECOV_TOKEN`
3. Regenerate token in Codecov dashboard if needed

### No Coverage Reports Appearing

**Symptom:** Codecov dashboard shows no reports

**Solution:**
1. Check that `npm run test:coverage` generates coverage files
2. Verify coverage files exist in `./coverage/` directory
3. Check CI logs for upload errors
4. Ensure repository is correctly linked in Codecov

### Coverage Dropping Unexpectedly

**Symptom:** Coverage percentage drops without removing tests

**Solution:**
1. Check if new files were added without tests
2. Review the Codecov diff to see which files lost coverage
3. Add tests for uncovered code

### Failed CI Due to Coverage

**Symptom:** CI fails with "Coverage threshold not met"

**Solution:**
1. Review the test output to see which thresholds failed
2. Add tests to meet the threshold (70% for all metrics)
3. Or temporarily lower thresholds in `jest.config.js` (not recommended)

## Best Practices

### 1. Monitor Coverage Trends
- Check coverage regularly in Codecov dashboard
- Set up notifications for large coverage drops

### 2. Set Reasonable Thresholds
- Current: 70% for all metrics
- Adjust based on project needs
- Don't aim for 100% - focus on critical paths

### 3. Use Coverage in Code Review
- Review Codecov comments on PRs
- Ensure new code is adequately tested
- Don't merge PRs that significantly drop coverage

### 4. Test Critical Code First
- Focus on services, utilities, and business logic
- UI components can have lower coverage
- Test error handling and edge cases

### 5. Keep Configuration Updated
- Update `.codecov.yml` as project grows
- Adjust thresholds based on project maturity
- Exclude generated or third-party code

## Additional Resources

- [Codecov Documentation](https://docs.codecov.com/)
- [Codecov GitHub Action](https://github.com/codecov/codecov-action)
- [Jest Coverage Documentation](https://jestjs.io/docs/configuration#coveragethreshold-object)

## Verification Checklist

- [ ] Codecov account created and repository added
- [ ] `CODECOV_TOKEN` secret added to GitHub repository
- [ ] CI workflow runs successfully with coverage upload
- [ ] Coverage reports appear in Codecov dashboard
- [ ] Coverage badge added to README (optional)
- [ ] `.codecov.yml` configuration file created (optional)
- [ ] Team members have access to Codecov dashboard

## Next Steps

After setup:
1. Review current coverage baseline in Codecov
2. Identify files with low coverage
3. Create issues to improve coverage for critical files
4. Set up Codecov notifications (email, Slack, etc.)
5. Configure branch protection to require coverage checks
