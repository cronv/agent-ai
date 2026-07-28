import { describe, expect, it } from 'vitest'

import type { ApartmentCard } from '../dialog/apartments.js'
import { CSV_BOM, buildCsv } from './csv.js'
import { exportFilename, exportLeadsCsv } from './export.js'
import type { LeadRow } from './leads.service.js'

function card(overrides: Partial<ApartmentCard> = {}): ApartmentCard {
  return {
    id: 'a1',
    projectId: 'p1',
    projectName: 'ЖК Северный',
    developer: null,
    district: null,
    metro: null,
    metroDistanceMin: null,
    rooms: 2,
    planType: null,
    area: 54.2,
    livingArea: null,
    kitchenArea: null,
    floor: 7,
    floorsTotal: 18,
    price: 18_400_000,
    pricePerM2: null,
    building: null,
    section: null,
    finishing: null,
    balcony: null,
    windowView: null,
    bathroom: null,
    euroPlan: null,
    deadline: null,
    planImageUrl: null,
    photos: [],
    url: null,
    ...overrides,
  }
}

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead1',
    conversationId: 'conv1',
    name: 'Иван Петров',
    phone: '+79123456789',
    phoneFormatted: '+7 (912) 345-67-89',
    comment: null,
    status: 'new',
    consentAt: new Date('2026-07-27T10:00:00Z'),
    apartments: [],
    selectedApartments: [],
    webhookStatus: 'skipped',
    webhookError: null,
    webhookAt: null,
    createdAt: new Date('2026-07-27T10:00:00Z'),
    updatedAt: new Date('2026-07-27T10:00:00Z'),
    conversation: {
      id: 'conv1',
      sessionId: 'sess1',
      page: 'https://site.ru/zhk',
      referrer: null,
      utm: { utm_source: 'yandex', utm_medium: 'cpc' },
      messageCount: 6,
      startedAt: new Date('2026-07-27T09:00:00Z'),
    },
    ...overrides,
  }
}

describe('buildCsv', () => {
  it('начинается с BOM и разделяет точкой с запятой — иначе Excel ломает кириллицу', () => {
    const csv = buildCsv(['Имя', 'Телефон'], [['Иван', '+7 (912) 345-67-89']])

    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv).toContain('Имя;Телефон')
    expect(csv).toContain('\r\n')
    // Кириллица остаётся кириллицей и в байтах UTF-8.
    expect(Buffer.from(csv, 'utf8').toString('utf8')).toContain('Иван')
  })

  it('прячет разделители, кавычки и переносы строк внутри ячейки', () => {
    const csv = buildCsv(['A'], [['две "строки";\nвторая']])

    expect(csv).toContain('"две ""строки"";\nвторая"')
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2)
  })

  it('обезвреживает ячейку, которую Excel счёл бы формулой', () => {
    const csv = buildCsv(['A'], [['=1+1']])
    expect(csv).toContain("'=1+1")
  })
})

describe('exportLeadsCsv', () => {
  it('выгружает то, с чем работает менеджер', () => {
    const csv = exportLeadsCsv([
      lead({
        comment: 'Перезвоните после 18',
        status: 'in_progress',
        apartments: [card()],
      }),
    ])

    expect(csv).toContain('Иван Петров')
    // Телефон в человеческом виде: со скобками Excel не примет его за число.
    expect(csv).toContain('+7 (912) 345-67-89')
    expect(csv).toContain('В работе')
    expect(csv).toContain('Перезвоните после 18')
    expect(csv).toContain('ЖК Северный')
    expect(csv).toContain('yandex')
    expect(csv).toContain('https://site.ru/zhk')
  })

  it('отделяет выбранные квартиры от просмотренных', () => {
    const csv = exportLeadsCsv([
      lead({
        apartments: [card(), card({ id: 'a2', projectName: 'ЖК Южный', rooms: 1, area: 36 })],
        selectedApartments: [card({ id: 'a2', projectName: 'ЖК Южный', rooms: 1, area: 36 })],
      }),
    ])

    const [headers = '', row = ''] = csv.replace(CSV_BOM, '').split('\r\n')
    const chosen = headers.split(';').indexOf('Выбрал квартиры')
    const shown = headers.split(';').indexOf('Смотрел квартиры')

    // Колонки разные, и выбранное стоит раньше: в Excel читают слева направо.
    expect(chosen).toBeGreaterThanOrEqual(0)
    expect(chosen).toBeLessThan(shown)
    // В строке выбранная квартира одна, а просмотренных две.
    expect(row).toContain('ЖК Южный')
    expect(csv).toContain('ЖК Северный')
  })

  it('показывает провалившийся вебхук вместе с текстом ошибки', () => {
    const csv = exportLeadsCsv([lead({ webhookStatus: 'failed', webhookError: 'HTTP 500' })])
    expect(csv).toContain('Ошибка: HTTP 500')
  })
})

describe('exportFilename', () => {
  it('содержит дату выгрузки', () => {
    expect(exportFilename(new Date(2026, 6, 27))).toBe('leads-2026-07-27.csv')
  })
})
