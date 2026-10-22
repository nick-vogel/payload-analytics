import { describe, it, expect, vi } from 'vitest'
import type { Condition, Field, GroupField, UIField } from 'payload'
import { createCollectionAnalyticsFields, CollectionAnalyticsField } from '@/fields/collectionAnalytics'
import type { CollectionAnalyticsConfig } from '@/types'

// Payload passes this third argument to every admin condition; this condition ignores it
const conditionContext: Parameters<Condition>[2] = {
  blockData: {},
  operation: 'update',
  path: [],
  user: null,
}

const createConfig = (overrides?: Partial<CollectionAnalyticsConfig>): CollectionAnalyticsConfig => ({
  enabled: true,
  rootPath: '/blog',
  ...overrides,
})

const asGroup = (field: Field | undefined): GroupField => {
  if (field?.type !== 'group') throw new Error(`expected a group field, got ${field?.type}`)
  return field
}

const getDataUIField = (group: GroupField): UIField => {
  const [uiField] = group.fields
  if (uiField.type !== 'ui') throw new Error(`expected a ui field, got ${uiField.type}`)
  return uiField
}

describe('createCollectionAnalyticsFields', () => {
  it('should return one Analytics group field by default', () => {
    const fields = createCollectionAnalyticsFields({ config: createConfig() })

    expect(fields).toHaveLength(1)
    const group = asGroup(fields[0])
    expect('name' in group && group.name).toBe('analytics')
    expect(group.label).toBe('Analytics')
    expect(group.fields).toHaveLength(1)
  })

  it('should render the CollectionAnalyticsField component by string path and carry the root path', () => {
    const uiField = getDataUIField(asGroup(createCollectionAnalyticsFields({ config: createConfig() })[0]))

    expect(uiField.name).toBe('data')
    expect(uiField.admin.components?.Field).toBe('payload-analytics-plugin/components/CollectionAnalyticsField')
    expect(uiField.admin.custom).toEqual({ rootPath: '/blog' })
  })

  it('should apply overrides on top of the default group', () => {
    const [field] = createCollectionAnalyticsFields({
      config: createConfig(),
      overrides: { label: 'Traffic', admin: { position: 'sidebar' } },
    })
    const group = asGroup(field)

    expect(group.label).toBe('Traffic')
    expect(group.admin).toEqual({ position: 'sidebar' })
    // Fields not overridden keep their defaults
    expect('name' in group && group.name).toBe('analytics')
    expect(group.fields).toHaveLength(1)
  })

  it('should hand the default fields to a fields customizer and return its result', () => {
    const extraField: Field = { name: 'notes', type: 'text' }
    const fieldsCustomizer = vi.fn<NonNullable<CollectionAnalyticsConfig['fields']>>(({ defaultFields }) => [
      ...defaultFields,
      extraField,
    ])

    const fields = createCollectionAnalyticsFields({ config: createConfig({ fields: fieldsCustomizer }) })

    expect(fieldsCustomizer).toHaveBeenCalledTimes(1)
    const [{ defaultFields }] = fieldsCustomizer.mock.calls[0]
    expect(defaultFields).toHaveLength(1)
    expect(asGroup(defaultFields[0]).label).toBe('Analytics')
    expect(fields).toEqual([defaultFields[0], extraField])
  })

  describe('condition', () => {
    const condition = asGroup(createCollectionAnalyticsFields({ config: createConfig() })[0]).admin?.condition

    it('should show the group for a saved document with a slug', () => {
      expect(condition?.({}, { id: 'abc', slug: 'hello-world' }, conditionContext)).toBeTruthy()
    })

    it('should hide the group for a new document that has no id yet', () => {
      expect(condition?.({}, { slug: 'hello-world' }, conditionContext)).toBeFalsy()
    })

    it('should hide the group for a document without a slug', () => {
      expect(condition?.({}, { id: 'abc' }, conditionContext)).toBeFalsy()
    })

    it('should hide the group when sibling data is missing', () => {
      expect(condition?.({}, {}, conditionContext)).toBeFalsy()
    })
  })
})

describe('CollectionAnalyticsField', () => {
  it('should return the default Analytics group for the given root path', () => {
    const group = CollectionAnalyticsField('/docs')

    expect(group.type).toBe('group')
    expect(group.label).toBe('Analytics')
    expect(getDataUIField(group).admin.custom).toEqual({ rootPath: '/docs' })
  })

  it('should apply overrides', () => {
    const group = CollectionAnalyticsField('/docs', { label: 'Page traffic' })

    expect(group.label).toBe('Page traffic')
    expect(getDataUIField(group).admin.custom).toEqual({ rootPath: '/docs' })
  })
})
