'use client'

import React from 'react'
import { useFormFields } from '@payloadcms/ui'
import { CollectionAnalytics } from './CollectionAnalytics'

export const CollectionAnalyticsField: React.FC<{ custom?: { rootPath?: string } }> = ({ custom }) => {
  // Get collection slug from URL
  const pathSegments = typeof window !== 'undefined' ? window.location.pathname.split('/') : []
  const adminIndex = pathSegments.indexOf('admin')
  const collectionSlug = adminIndex >= 0 ? pathSegments[adminIndex + 2] : '' // admin/collections/[slug]
  
  // Get the current document's slug from form fields
  const { slug } = useFormFields(([fields]) => {
    return {
      slug: fields?.slug?.value as string | undefined
    }
  })

  const rootPath = custom?.rootPath || '/'

  if (!slug || !collectionSlug) {
    return null
  }

  return (
    <CollectionAnalytics 
      collectionSlug={collectionSlug}
      documentSlug={slug}
      rootPath={rootPath}
    />
  )
}

export default CollectionAnalyticsField