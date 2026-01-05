# Branch Protection Rules Configuration

This document outlines the recommended branch protection rules for the BOUNTYExpo repository to ensure code quality and prevent breaking changes.

## Overview

Branch protection rules need to be configured in the GitHub repository settings. These rules cannot be automated via code and must be manually set up by a repository administrator.

## Recommended Configuration

### For `main` branch:

1. **Navigate to Settings**
   - Go to Repository Settings → Branches → Add rule
   - Branch name pattern: `main`

2. **Protect matching branches**
   - ✅ Require a pull request before merging
     - ✅ Require approvals: **1** (minimum)
     - ✅ Dismiss stale pull request approvals when new commits are pushed
     - ✅ Require review from Code Owners (if CODEOWNERS file exists)
   
   - ✅ Require status checks to pass before merging
     - ✅ Require branches to be up to date before merging
     - **Required status checks:**
       - `Run Tests (18.x)` - Unit, integration, and E2E tests on Node 18
       - `Run Tests (20.x)` - Unit, integration, and E2E tests on Node 20
       - `Build Validation` - Expo export build validation
       - `Lint Code` - ESLint checks
       - `Security Audit` - npm audit and dependency checks
   
   - ✅ Require conversation resolution before merging
   
   - ✅ Require signed commits (optional but recommended)
   
   - ✅ Require linear history (optional - prevents merge commits)
   
   - ✅ Include administrators (applies rules to admins too)
   
   - ✅ Restrict who can push to matching branches (optional)
   
   - ✅ Allow force pushes: **Never**
   
   - ✅ Allow deletions: **Never**

### For `develop` branch:

1. **Similar settings as main but with some relaxation:**
   - Branch name pattern: `develop`
   - ✅ Require a pull request before merging
     - ✅ Require approvals: **1** (minimum)
   
   - ✅ Require status checks to pass before merging
     - **Required status checks:**
       - `Run Tests (20.x)` - At minimum, require tests on Node 20
       - `Build Validation` - Expo export build validation
   
   - ✅ Require conversation resolution before merging
   
   - ✅ Allow force pushes: **Never**
   
   - ✅ Allow deletions: **Never**

## How to Configure

### Step-by-Step Guide:

1. **Access Repository Settings**
   ```
   Repository → Settings → Branches (left sidebar)
   ```

2. **Add Branch Protection Rule**
   - Click "Add rule" button
   - Enter branch name pattern (e.g., `main`)

3. **Configure Protection Settings**
   - Check boxes according to the recommendations above
   - Add required status checks by typing their exact names

4. **Save Changes**
   - Scroll to bottom and click "Create" or "Save changes"

## Status Check Names

The following status check names must match exactly as they appear in the CI workflow:

- `Run Tests (18.x)`
- `Run Tests (20.x)`
- `Build Validation`
- `Lint Code`
- `Security Audit`

## Additional Recommendations

### Rulesets (GitHub Enterprise)

If using GitHub Enterprise, consider using Rulesets for more advanced protection:
- Repository → Settings → Rules → Rulesets
- Create a ruleset with similar protections but with more granular control

### CODEOWNERS File

Create a `.github/CODEOWNERS` file to automatically request reviews from specific team members:

```
# Example CODEOWNERS file
# Global owners
* @kodaksax

# React Native components
/components/** @kodaksax
/app/** @kodaksax

# Backend services
/server/** @kodaksax
/services/** @kodaksax

# CI/CD workflows
/.github/workflows/** @kodaksax

# Database migrations
/supabase/migrations/** @kodaksax
```

## Troubleshooting

### Status checks not appearing
- Ensure the CI workflow has run at least once on the branch
- Check that the job names in `.github/workflows/ci.yml` match exactly
- Wait for CI to complete before adding status checks

### Bypassing protection for emergencies
- Repository administrators can bypass protections temporarily
- Document any bypasses in commit messages or PR descriptions
- Re-enable protections immediately after emergency fixes

## Verification

After setting up branch protection rules:

1. Try pushing directly to `main` - should be blocked
2. Create a test PR without required status checks - should be blocked from merging
3. Create a test PR with failing tests - should be blocked from merging
4. Create a test PR with passing tests - should be mergeable

## References

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Required Status Checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
- [GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
