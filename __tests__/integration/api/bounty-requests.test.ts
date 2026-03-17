import request from 'supertest'

// Set NODE_ENV=test before loading the server so it doesn't call listen()
beforeAll(() => {
  (process.env as any).NODE_ENV = 'test'
})

// Mock the DB connect used by api/server.js
jest.mock('../../../lib/db', () => ({
  connect: jest.fn()
}))

import { connect as mockConnectFactory } from '../../../lib/db'

// Import the Express app (server listens are skipped in test mode)
const app = require('../../../api/server')

describe('Bounty Requests API (MySQL fallback) - ratings aggregation', () => {
  let mockConn: any

  beforeEach(() => {
    jest.resetAllMocks()

    // Create a mock connection with an execute method and end()
    mockConn = {
      execute: jest.fn(async (sql: string, params?: any[]) => {
        // Return main bounty_request rows when selecting from bounty_requests join
        if (/FROM bounty_requests/i.test(sql)) {
          return [[{
            id: 'req1',
            bounty_id: 'b1',
            hunter_id: 'hunter1',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            bounty_title: 'Test Bounty',
            bounty_amount: 100,
            bounty_location: 'Here',
            bounty_work_type: 'task',
            bounty_deadline: null,
            bounty_is_for_honor: 0,
            profile_username: 'hunter_one',
            profile_avatar_url: null
          }]]
        }

        // Ratings aggregation query
        if (/FROM ratings/i.test(sql)) {
          return [[
            { to_user_id: 'hunter1', rating: 4 },
            { to_user_id: 'hunter1', rating: 5 }
          ]]
        }

        // Legacy user_ratings
        if (/FROM user_ratings/i.test(sql)) {
          return [[
            { user_id: 'hunter1', score: 5 }
          ]]
        }

        // Default: return empty
        return [[]]
      }),
      end: jest.fn(async () => {})
    }

    ;(mockConnectFactory as any).mockResolvedValue(mockConn)
  })

  it('GET /api/bounty-requests includes averageRating and ratingCount on profile', async () => {
    const res = await request(app).get('/api/bounty-requests')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    const first = res.body[0]
    expect(first).toHaveProperty('profile')
    expect(first.profile).toHaveProperty('averageRating')
    expect(first.profile).toHaveProperty('ratingCount')
    expect(first.profile.ratingCount).toBe(2)
    expect(first.profile.averageRating).toBeCloseTo(4.5)
  })

  it('POST /api/bounty-requests/batch includes aggregated ratings for batched results', async () => {
    const res = await request(app)
      .post('/api/bounty-requests/batch')
      .send({ bounty_ids: ['b1'] })

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    const first = res.body[0]
    expect(first).toHaveProperty('profile')
    expect(first.profile.ratingCount).toBe(2)
    expect(first.profile.averageRating).toBeCloseTo(4.5)
  })
})
