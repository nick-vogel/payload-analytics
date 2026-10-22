'use client'

import React from 'react'
import {SelectInput, type ReactSelectOption} from '@payloadcms/ui'
import type {ComparisonOption, ComparisonData} from '../types'

interface ComparisonSelectorProps {
    value: ComparisonData | null
    onChange: (value: ComparisonData | null) => void
    currentPeriod: string
    currentStartDate?: string
    currentEndDate?: string
}

const COMPARISON_OPTIONS = [
    {label: 'No comparison', value: 'none'},
    {label: 'Previous period', value: 'previousPeriod'},
    {label: 'Same period last year', value: 'sameLastYear'},
    {label: 'Custom date range', value: 'custom'},
]

export const ComparisonSelector: React.FC<ComparisonSelectorProps> = ({
                                                                          value,
                                                                          onChange,
                                                                      }) => {

    const handleComparisonChange = (option: ReactSelectOption | ReactSelectOption[]) => {
        const selectedValue = Array.isArray(option) ? option[0]?.value : option?.value
        if (!option || selectedValue === 'none') {
            onChange(null)
            return
        }

        const newValue = selectedValue as ComparisonOption

        if (newValue === 'custom') {
            onChange({
                period: 'custom',
                customStartDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                customEndDate: new Date().toISOString().split('T')[0],
            })
        } else {
            onChange({period: newValue})
        }
    }

    return (
        <SelectInput
            label="Compare to"
            name="analytics-comparison"
            path="analytics-comparison"
            value={value ? (value.period === 'custom' ? 'custom' : value.period) : 'none'}
            onChange={handleComparisonChange}
            options={COMPARISON_OPTIONS}
            isClearable={false}
            isSortable={false}
        />
    )
}