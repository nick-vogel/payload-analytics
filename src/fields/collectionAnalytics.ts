import type { Field, GroupField } from 'payload'
import type { CollectionAnalyticsConfig } from '../types'

export interface CollectionAnalyticsFieldArgs {
  config: CollectionAnalyticsConfig
  overrides?: Partial<GroupField>
}

export const createCollectionAnalyticsFields = ({ config, overrides }: CollectionAnalyticsFieldArgs): Field[] => {
  const analyticsField: GroupField = {
    name: 'analytics',
    type: 'group',
    label: 'Analytics',
    admin: {
      condition: (_, siblingData) => {
        // Only show for existing documents with a slug
        return siblingData?.id && siblingData?.slug
      },
    },
    fields: [
      {
        name: 'data',
        type: 'ui',
        admin: {
          components: {
            Field: 'payload-analytics-plugin/components/CollectionAnalyticsField',
          },
          custom: {
            rootPath: config.rootPath,
          },
        },
      },
    ],
    ...overrides,
  }

  // If fields customization is provided, use it
  if (config.fields) {
    return config.fields({ defaultFields: [analyticsField] })
  }

  return [analyticsField]
}

// Export a simpler function for manual use
export const CollectionAnalyticsField = (rootPath: string, overrides?: Partial<GroupField>): GroupField => {
  return createCollectionAnalyticsFields({
    config: { enabled: true, rootPath },
    overrides,
  })[0] as GroupField
}