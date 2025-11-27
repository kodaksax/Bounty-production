# 🚀 BOUNTYExpo MVP - Quick Start Guide

**For Developers Starting MVP Work Today**  
**Last Updated:** November 27, 2025

---

## 📋 TL;DR - What to Do Right Now

BOUNTYExpo is **92% complete** and needs **1-2 weeks** to reach App Store submission. The following items are already done:

### ✅ Already Implemented
- Privacy Policy & Terms of Service (in-app, Legal section)
- 18+ Age Verification checkbox (sign-up form)
- Terms acceptance checkbox (sign-up form)
- Analytics & error tracking (Mixpanel + Sentry)
- Onboarding carousel (4 screens)
- Search & filtering (bounties + users)
- Notifications (in-app + push infrastructure)
- Loading states & error handling

### 🎯 Remaining Tasks (1-2 weeks)

**This Week (Week 1):**
1. 🌐 **Host Privacy Policy externally** (0.5 day) - For App Store Connect URL field
2. 💾 **Persist age_verified to profile** (0.5 day) - For compliance audit trail
3. 🛡️ **Add moderation queue to admin** (2 days) - Reports table + admin UI
4. 📸 **Create App Store assets** (2 days) - Screenshots, description, keywords

**Next Week (Week 2):**
5. 💰 **Complete escrow flows** (3 days) - Accept → Hold → Release/Refund
6. 🧪 **Final testing & QA** (2 days) - Manual testing on devices
7. 🚀 **App Store submission** (1 day)

---

## 🎯 Immediate Actions (Next 48 Hours)

### Action 1: Set Up Development Environment (30 minutes)

```bash
# Clone and install
git clone https://github.com/kodaksax/bountyexpo.git
cd bountyexpo
npm install

# Start infrastructure
npm run dev

# In new terminal: Start API
npm run dev:api

# In new terminal: Start mobile app
npm start
```

**Verify:**
- ✅ App loads on simulator/device
- ✅ Can sign in/sign up
- ✅ Can view bounties in Postings
- ✅ Can navigate between tabs

---

### Action 2: Create First PR - Privacy Policy (Day 1)

**Branch:** `feat/privacy-policy-terms`

**Steps:**
1. Use template generator: [TermsFeed Privacy Policy Generator](https://www.termsfeed.com/privacy-policy-generator/)
2. Fill in BOUNTYExpo details:
   - Company: Your name/company
   - Website: GitHub repo URL
   - App: BOUNTYExpo
   - Data collected: Email, location, payment info, profile data
   - Third parties: Supabase (auth), Stripe (payments), Expo (push notifications)
3. Download Privacy Policy and Terms of Service
4. Create markdown files:
   ```bash
   mkdir -p docs/legal
   # Add privacy-policy.md and terms-of-service.md
   ```
5. Host on GitHub Pages:
   ```yaml
   # .github/workflows/deploy-docs.yml
   name: Deploy Docs
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: peaceiris/actions-gh-pages@v3
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./docs
   ```
6. Add links to app:
   ```tsx
   // app/tabs/profile-screen.tsx
   <TouchableOpacity onPress={() => Linking.openURL('https://kodaksax.github.io/bountyexpo/privacy-policy')}>
     <Text>Privacy Policy</Text>
   </TouchableOpacity>
   ```
7. Add onboarding acceptance:
   ```tsx
   // app/auth/sign-up-form.tsx
   <Checkbox checked={acceptedTerms} onChange={setAcceptedTerms} />
   <Text>I agree to the Terms of Service and Privacy Policy</Text>
   ```

**Commit & PR:** "feat: Add Privacy Policy and Terms of Service"

---

### Action 3: Add Content Moderation (Days 2-5)

**Branch:** `feat/content-moderation`

**Day 2: Database Setup**
```sql
-- services/api/drizzle/migrations/002_add_reports.sql
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID REFERENCES users(id) NOT NULL,
  reported_user_id UUID REFERENCES users(id),
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE blocked_users (
  blocker_id UUID REFERENCES users(id) NOT NULL,
  blocked_id UUID REFERENCES users(id) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);
```

Run migration:
```bash
npm run --workspace=@bountyexpo/api db:migrate
```

**Day 3: Backend API**
```typescript
// services/api/src/routes/reports.ts
import { Router } from 'express';

export const reportsRouter = Router();

reportsRouter.post('/reports', async (req, res) => {
  const { content_type, content_id, reason, details } = req.body;
  const reporter_id = req.user.id; // From JWT middleware

  // Validate
  if (!['bounty', 'user', 'message'].includes(content_type)) {
    return res.status(400).json({ error: 'Invalid content type' });
  }

  // Create report
  const report = await db.insert(reports).values({
    reporter_id,
    content_type,
    content_id,
    reason,
    details,
  }).returning();

  res.json({ success: true, report });
});

reportsRouter.get('/admin/reports', requireAdmin, async (req, res) => {
  const allReports = await db.select()
    .from(reports)
    .orderBy(reports.created_at, 'desc');
  
  res.json({ reports: allReports });
});
```

**Day 4-5: Frontend UI**
```tsx
// components/report-modal.tsx
export function ReportModal({ contentType, contentId, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');

  const reasons = [
    { value: 'spam', label: 'Spam' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'inappropriate', label: 'Inappropriate Content' },
    { value: 'fraud', label: 'Fraud or Scam' },
    { value: 'other', label: 'Other' },
  ];

  const handleSubmit = async () => {
    await fetch(`${API_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType, content_id: contentId, reason, details }),
    });
    Alert.alert('Report Submitted', 'Thank you. We will review this content.');
    onClose();
  };

  return (
    <Modal visible={true}>
      <Text>Report {contentType}</Text>
      <Picker selectedValue={reason} onValueChange={setReason}>
        {reasons.map(r => <Picker.Item key={r.value} label={r.label} value={r.value} />)}
      </Picker>
      <TextInput 
        placeholder="Additional details (optional)" 
        value={details} 
        onChangeText={setDetails} 
        multiline 
      />
      <Button title="Submit Report" onPress={handleSubmit} />
      <Button title="Cancel" onPress={onClose} />
    </Modal>
  );
}
```

Add report buttons:
```tsx
// app/postings/[bountyId]/index.tsx
<TouchableOpacity onPress={() => setShowReportModal(true)}>
  <Icon name="flag" />
  <Text>Report</Text>
</TouchableOpacity>

{showReportModal && (
  <ReportModal 
    contentType="bounty" 
    contentId={bountyId} 
    onClose={() => setShowReportModal(false)} 
  />
)}
```

**Commit & PR:** "feat: Add content moderation and reporting system"

---

## 📊 Progress Tracking

Use this checklist to track your progress:

### Week 1: App Store Requirements ✅
- [ ] Privacy Policy live (https://yoursite.com/privacy)
- [ ] Terms of Service live (https://yoursite.com/terms)
- [ ] Links added to app Settings
- [ ] Acceptance checkbox in onboarding
- [ ] Report buttons on bounties, profiles, messages
- [ ] Reports API endpoint working
- [ ] Admin panel for reports functional
- [ ] Age verification: 18+ checkbox on sign-up
- [ ] Age gating for payment features

### Week 2: App Store Assets ✅
- [ ] 10 screenshots taken (iPhone 6.5" and 5.5")
- [ ] App description written (500-1000 words)
- [ ] Keywords researched and selected
- [ ] App icon 1024x1024 created
- [ ] All assets uploaded to `assets/app-store/`

### Week 3-4: Core Functionality ⏳
- [ ] Bounty acceptance flow complete
- [ ] Escrow payment integration working
- [ ] In-progress bounty screens functional
- [ ] Real-time messaging connected

### Week 5: Polish ⏳
- [ ] Notifications system (in-app + push)
- [ ] Search and filtering
- [ ] Onboarding carousel
- [ ] Loading and empty states

### Week 6: Testing & Submission 🎯
- [ ] Automated tests (70%+ coverage)
- [ ] Manual QA completed
- [ ] All bugs fixed
- [ ] Production build created
- [ ] App Store submission

---

## 🛠️ Development Tips

### Quick Commands
```bash
# Type check before committing
npm run type-check

# Run tests
npm test

# View API logs
npm run dev:logs

# Reset database (fresh start)
npm run dev:stop
docker volume rm bountyexpo_postgres_data
npm run dev
npm run dev:api
```

### Common Issues

**"Cannot connect to database"**
```bash
# Check if PostgreSQL is running
docker ps

# Restart services
npm run dev:stop
npm run dev
```

**"Stripe payment fails"**
- Use test card: 4242 4242 4242 4242
- Ensure using test keys (starts with `sk_test_` and `pk_test_`)

**"Type errors in IDE"**
```bash
# Restart TypeScript server in VS Code
Cmd+Shift+P → "TypeScript: Restart TS Server"
```

---

## 📞 Getting Help

### Documentation
- **Main Roadmap:** `MVP_ROADMAP.md` - Full feature breakdown
- **PR Templates:** `MVP_PR_PROMPTS.md` - Copy-paste PR descriptions
- **This Guide:** `MVP_QUICK_START.md` - Quick start for today

### Resources
- [Expo Docs](https://docs.expo.dev/)
- [Stripe Connect Guide](https://stripe.com/docs/connect)
- [App Store Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### Community
- Create GitHub issues for bugs
- Use Discussions for feature questions
- Tag @kodaksax for urgent reviews

---

## ✅ Success Checklist (Week 1)

By end of Week 1, you should have:
- [x] Development environment running
- [x] Privacy Policy and Terms of Service live
- [x] Content moderation system working
- [x] First 2 PRs merged

**Next:** Move to Week 2 tasks (age verification, App Store assets)

---

## 🎉 You're Ready!

You now have:
1. ✅ Clear understanding of MVP scope (75% done, 25% to go)
2. ✅ Immediate next actions (Privacy Policy, Content Moderation)
3. ✅ 6-week timeline to App Store submission
4. ✅ PR templates for all features
5. ✅ Testing and QA checklists

**Start with Privacy Policy today. Let's ship this! 🚀**

---

**Questions?** Open an issue or discussion on GitHub!
