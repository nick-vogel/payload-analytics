import { describe, it, expect } from 'vitest'
import type { Condition, Field, UIField } from 'payload'
import { createAnalyticsTab } from '@/fields/analyticsTab'

// Payload passes this third argument to every admin condition; these conditions ignore it
const conditionContext: Parameters<Condition>[2] = {
  blockData: {},
  operation: 'update',
  path: [],
  user: null,
}

// Walk tabs > Analytics tab > the single UI field, failing loudly if the shape changes
const getAnalyticsUIField = (field: Field): UIField => {
  if (field.type !== 'tabs') throw new Error(`expected a tabs field, got ${field.type}`)
  const [uiField] = field.tabs[0].fields
  if (uiField.type !== 'ui') throw new Error(`expected a ui field, got ${uiField.type}`)
  return uiField
}

describe('createAnalyticsTab', () => {
  it('should return a single Analytics tab holding one UI field', () => {
    const field = createAnalyticsTab('posts', '/blog')

    expect(field.type).toBe('tabs')
    if (field.type !== 'tabs') return
    expect(field.tabs).toHaveLength(1)
    expect(field.tabs[0].label).toBe('Analytics')
    expect(field.tabs[0].fields).toHaveLength(1)
    expect(getAnalyticsUIField(field).name).toBe('analyticsDisplay')
  })

  it('should point the UI field at the CollectionAnalyticsField component by string path', () => {
    const uiField = getAnalyticsUIField(createAnalyticsTab('posts', '/blog'))

    expect(uiField.admin.components?.Field).toEqual({
      path: 'payload-analytics-plugin/components/CollectionAnalyticsField',
      exportName: 'default',
      clientProps: {
        collectionSlug: 'posts',
        rootPath: '/blog',
      },
    })
  })

  it('should pass each call its own collection slug and root path', () => {
    const uiField = getAnalyticsUIField(createAnalyticsTab('products', '/shop'))

    expect(uiField.admin.components?.Field).toMatchObject({
      clientProps: { collectionSlug: 'products', rootPath: '/shop' },
    })
  })

  describe('condition', () => {
    const condition = getAnalyticsUIField(createAnalyticsTab('posts', '/blog')).admin.condition

    it('should be defined', () => {
      expect(condition).toBeTypeOf('function')
    })

    it('should show the tab for a saved document with a slug', () => {
      expect(condition?.({ id: 'abc', slug: 'hello-world' }, {}, conditionContext)).toBe(true)
    })

    it('should hide the tab for a new document that has no id yet', () => {
      expect(condition?.({ slug: 'hello-world' }, {}, conditionContext)).toBe(false)
    })

    it('should hide the tab for a document without a slug', () => {
      expect(condition?.({ id: 'abc' }, {}, conditionContext)).toBe(false)
      expect(condition?.({ id: 'abc', slug: '' }, {}, conditionContext)).toBe(false)
    })

    it('should hide the tab when there is no document data', () => {
      expect(condition?.({}, {}, conditionContext)).toBe(false)
    })
  })
})
