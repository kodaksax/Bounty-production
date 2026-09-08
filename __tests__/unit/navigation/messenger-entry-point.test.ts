import fs from 'node:fs'
import path from 'node:path'

describe('My Bounties messenger entry point', () => {
  it('uses the canonical themed messenger route', () => {
    const inboxSource = fs.readFileSync(
      path.join(process.cwd(), 'app/tabs/inbox-screen.tsx'),
      'utf8',
    )

    expect(inboxSource).toContain('router.push(ROUTES.TABS.MESSENGER as never)')
    expect(inboxSource).not.toContain("router.push('/tabs/messenger' as never)")
  })
})
