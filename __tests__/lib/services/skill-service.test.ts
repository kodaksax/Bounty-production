import { skillService } from '../../../lib/services/skill-service'

describe('skillService', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
    jest.resetAllMocks()
  })

  test('getById returns null on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    const res = await skillService.getById(123)
    expect(res.skill).toBeNull()
    expect(res.error).toBeInstanceOf(Error)
    expect(res.error!.message).toBe('Skill not found')
  })

  test('getAll returns empty array on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'))
    const res = await skillService.getAll()
    expect(res.skills).toEqual([])
    expect(res.error).toBeInstanceOf(Error)
  })
})
