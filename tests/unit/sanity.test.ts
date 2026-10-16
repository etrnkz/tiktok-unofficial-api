import { describe, it, expect } from 'vitest'

describe('Sanity Check', () => {
  it('should run tests successfully', () => {
    expect(1 + 1).toBe(2)
  })

  it('should have project configured correctly', () => {
    expect(process.env.NODE_ENV).toBeDefined()
  })
})
