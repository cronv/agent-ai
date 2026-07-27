import { describe, expect, it } from 'vitest'

import { resolveAllowedOrigin } from './public-cors.js'

/**
 * Белый список доменов виджета. Проверяется отдельно от HTTP: список приходит
 * из `WIDGET_ALLOWED_ORIGINS`, которая читается один раз на старте процесса,
 * и подменять её в тесте маршрута нечем.
 */
describe('resolveAllowedOrigin', () => {
  it('без белого списка разрешает любой домен — адреса сайтов заранее неизвестны', () => {
    expect(resolveAllowedOrigin('https://any.example', [])).toBe('*')
    expect(resolveAllowedOrigin(undefined, [])).toBe('*')
  })

  it('со списком возвращает сам домен, а не звёздочку', () => {
    expect(resolveAllowedOrigin('https://site.ru', ['https://site.ru'])).toBe('https://site.ru')
  })

  it('домен вне списка не разрешает', () => {
    expect(resolveAllowedOrigin('https://evil.example', ['https://site.ru'])).toBeNull()
  })

  it('запрос без Origin при непустом списке не разрешает', () => {
    expect(resolveAllowedOrigin(undefined, ['https://site.ru'])).toBeNull()
    expect(resolveAllowedOrigin('', ['https://site.ru'])).toBeNull()
  })

  it('хвостовой слэш в Origin не мешает совпадению', () => {
    expect(resolveAllowedOrigin('https://site.ru/', ['https://site.ru'])).toBe('https://site.ru/')
  })
})
