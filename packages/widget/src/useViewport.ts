import { useEffect, useState } from 'preact/hooks'

/**
 * Мобильный экран и экранная клавиатура.
 *
 * На телефоне чат раскрыт на весь экран. Стоит человеку тронуть поле ввода —
 * снизу выезжает клавиатура, но `100vh` про неё не знает: поле ввода уезжает
 * под клавиатуру, и посетитель не видит, что печатает. Единственное, что знает
 * настоящую высоту видимой области, — `window.visualViewport`.
 *
 * Поэтому высота панели на телефоне берётся из `visualViewport.height`, а сама
 * панель сдвигается на `offsetTop` — так она остаётся ровно в видимой части,
 * даже когда Safari «поднимает» страницу под клавиатуру.
 */

const MOBILE_QUERY = '(max-width: 560px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const update = (): void => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return mobile
}

export interface ViewportBox {
  height: number
  offsetTop: number
}

/** Видимая область экрана. `null`, пока панель закрыта или это не телефон. */
export function useVisualViewport(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) {
      setBox(null)
      return
    }

    const update = (): void => {
      setBox({ height: viewport.height, offsetTop: viewport.offsetTop })
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      setBox(null)
    }
  }, [active])

  return box
}

/**
 * Пока чат открыт на весь экран, страница под ним не должна прокручиваться:
 * иначе палец скроллит сайт вместо переписки. Прежнее значение возвращается
 * на место при закрытии — виджет не имеет права оставить чужую страницу
 * заблокированной.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const { body } = document
    const previous = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previous
    }
  }, [active])
}
