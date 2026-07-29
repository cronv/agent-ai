import type { ApartmentCard } from './apartments.js'
import { areaRange, millions, plural, priceRange, roomsLabel } from './wording.js'

/**
 * Чем показанные квартиры похожи и чем отличаются.
 *
 *   const variety = describeVariety(cards)
 *   // { nearlyIdentical: true, same: [...], differs: ['этаж — с 8 по 17', …], hint: '…' }
 *
 * ── Зачем это нужно ────────────────────────────────────────────────────────
 *
 * Запрос «студия в Домодедово до 5 млн» находит двадцать пять почти одинаковых
 * лотов: один ЖК, одна комнатность, 29 м², без отделки, разница — этаж и
 * две сотни тысяч рублей. Модель, получив пять таких карточек, писала о них
 * нумерованным списком из пяти пунктов, пересказывая то, что и так нарисовано
 * на карточке, — а чтобы пункты не выглядели копиями друг друга, дописывала
 * отличия от себя: «разные планировки кухни», «готова к быстрой сдаче».
 * Это тот же класс ошибки, что выдуманная ставка по ипотеке, только про
 * планировки: в данных этого нет.
 *
 * Запрет «не перечисляй» сам по себе не работает — модели нечего сказать
 * вместо перечня. Поэтому вместе с подборкой ей уходит готовый ответ на вопрос
 * «чем они отличаются»: посчитанный, а не угаданный. Приём тот же, что у блока
 * `nothing_found` в пустой выдаче (см. execute.ts).
 */

export interface ShownVariety {
  /** Что у всех показанных одинаково: «ЖК «Космос»», «студии», «без отделки». */
  same: string[]
  /** Чем они различаются: «этаж — с 8 по 17», «цена — от 4,7 до 5,1 млн ₽». */
  differs: string[]
  /**
   * Варианты различаются только этажом, ценой и мелочами вроде вида из окна.
   * Такую подборку описывают одной фразой, а не списком.
   */
  nearlyIdentical: boolean
  /** Готовая формулировка: модель повторяет то, что видит, — проще дать фразу. */
  hint: string
}

/** Насколько площади считаются «одинаковыми»: разброс в пределах метра. */
const SAME_AREA_SPREAD_M2 = 1

/**
 * Признак, известный у всех показанных лотов, — или `null`.
 *
 * Пустое поле здесь опаснее, чем кажется. У ДомКлика и вторички этаж, отделка
 * и срок сдачи заполнены не всегда, а `null`, отброшенный вместе с остальными
 * пропусками, превращает признак одного лота в общий: «все на 5 этаже», когда
 * этаж известен у одного из пяти. Модель обязана отвечать по этому блоку и
 * повторит такое дословно — получится ровно то выдуманное отличие, против
 * которого блок и написан. Поэтому признак, известный не у всех, не попадает
 * ни в «одинаковые», ни в «разные»: про него просто не говорим.
 */
function knownForAll<T>(cards: ApartmentCard[], pick: (card: ApartmentCard) => T | null): T[] | null {
  const values: T[] = []
  for (const card of cards) {
    const value = pick(card)
    if (value === null) return null
    values.push(value)
  }
  return values
}

/**
 * Признаки, по которым лот отличается от соседнего по существу, а не мелочью.
 * Этаж, цена и вид из окна сюда не входят намеренно: именно ими и различаются
 * лоты одного дома, и подборка от этого не перестаёт быть однообразной.
 *
 * Неизвестное значение хотя бы у одного лота снимает вопрос: назвать подборку
 * «практически одинаковой», не зная её площадей или отделки, нельзя.
 */
function isSameKind(cards: ApartmentCard[]): boolean {
  const areas = knownForAll(cards, (card) => card.area)
  if (areas === null || Math.max(...areas) - Math.min(...areas) > SAME_AREA_SPREAD_M2) return false

  return [
    knownForAll(cards, (card) => card.projectName),
    knownForAll(cards, (card) => roomsKey(card)),
    knownForAll(cards, (card) => normalize(card.finishing)),
    knownForAll(cards, (card) => card.deadline),
  ].every((values) => values !== null && new Set(values).size === 1)
}

export function describeVariety(cards: ApartmentCard[]): ShownVariety | null {
  if (cards.length < 2) return null

  const same: string[] = []
  const differs: string[] = []

  /** Признак словами: одинаковый у всех — в одну колонку, разный — в другую. */
  const compare = (
    pick: (card: ApartmentCard) => string | null,
    say: { same: (value: string) => string; differs: (values: string[]) => string },
  ): void => {
    const values = knownForAll(cards, pick)
    if (values === null) return
    const unique = [...new Set(values)]
    if (unique.length === 1 && unique[0] !== undefined) same.push(say.same(unique[0]))
    else differs.push(say.differs(unique))
  }

  compare((card) => card.projectName, {
    same: (name) => `все в ЖК «${name}»`,
    differs: (names) => `ЖК — ${names.join(', ')}`,
  })

  compare(roomsKey, {
    same: (rooms) => `все ${rooms}`,
    differs: (rooms) => `комнатность — ${rooms.join(', ')}`,
  })

  const areas = knownForAll(cards, (card) => card.area)
  if (areas !== null) {
    const min = Math.min(...areas)
    const max = Math.max(...areas)
    // «Около 29 м²», а не «около 28,9»: разброс здесь меньше метра, и точная
    // цифра одного лота выдавала бы себя за общую.
    if (max - min <= SAME_AREA_SPREAD_M2) {
      same.push(`площадь у всех около ${min === max ? format(min) : Math.round((min + max) / 2)} м²`)
    } else differs.push(`площадь — ${areaRange(min, max)}`)
  }

  compare((card) => normalize(card.finishing), {
    same: (finishing) => `отделка у всех «${finishing}»`,
    differs: (values) => `отделка — ${values.join(', ')}`,
  })

  // Готовность идёт впереди срока и вместо него: у сданного дома срок стоит
  // в прошлом, и «срок сдачи у всех один» про декабрь 2023-го — не то, что
  // нужно сказать человеку, которому можно отдать ключи сегодня.
  const readiness = knownForAll(cards, (card) => (card.isReady === null ? null : card.isReady))
  const allReady = readiness !== null && readiness.every((value) => value)
  if (readiness !== null && new Set(readiness).size > 1) {
    differs.push('часть домов уже сдана, часть ещё строится')
  } else if (allReady) {
    same.push('дома уже сданы, ключи сразу')
  }

  if (!allReady) {
    compare((card) => card.deadline, {
      same: () => 'срок сдачи у всех один',
      differs: () => 'разные сроки сдачи',
    })
  }

  const floors = knownForAll(cards, (card) => card.floor)
  if (floors !== null) {
    const min = Math.min(...floors)
    const max = Math.max(...floors)
    if (min !== max) differs.push(`этаж — с ${min} по ${max}`)
    else same.push(`все на ${min} этаже`)
  }

  const prices = knownForAll(cards, (card) => (Number.isFinite(card.price) && card.price > 0 ? card.price : null))
  if (prices !== null) {
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    if (Math.round(min) !== Math.round(max)) differs.push(`цена — ${priceRange(min, max)}`)
    else same.push(`цена у всех ${millions(min)}`)
  }

  const nearlyIdentical = isSameKind(cards)
  return { same, differs, nearlyIdentical, hint: buildHint(cards.length, same, differs, nearlyIdentical) }
}

function buildHint(count: number, same: string[], differs: string[], nearlyIdentical: boolean): string {
  const shown = `${count} ${plural(count, 'вариант', 'варианта', 'вариантов')}`
  const sameText = same.length > 0 ? same.join(', ') : 'одного типа'
  const differsText = differs.length > 0 ? differs.join('; ') : 'ничем, кроме номера лота'

  if (nearlyIdentical) {
    return (
      `Показанные ${shown} практически одинаковы: ${sameText}. Отличаются только так: ${differsText}. ` +
      'Не перечисляй их по одному и не расписывай характеристики — они и так нарисованы на карточках рядом с твоим ответом. ' +
      'Скажи двумя-тремя фразами: сколько нашлось всего, что варианты почти не отличаются друг от друга и чем именно отличаются, ' +
      'и задай один уточняющий вопрос. ' +
      'Никаких других отличий у них нет: разные планировки, виды из окна, «удачное расположение» и «готовность к сдаче» — ' +
      'это выдумка ровно в той же мере, что и придуманная цена.'
    )
  }

  return (
    `Показанные ${shown} различаются так: ${differsText}. Общее у них: ${sameText}. ` +
    'Опиши разницу одной-двумя фразами и скажи, на что смотреть в первую очередь. Не пересказывай карточки по пунктам: ' +
    'площадь, этаж, отделка и срок на них уже написаны. Отличий, которых нет в этом перечне, не придумывай.'
  )
}

function roomsKey(card: ApartmentCard): string | null {
  if (card.rooms !== null) return roomsLabel(card.rooms)
  return card.planType === null ? null : card.planType.toLowerCase()
}

function normalize(value: string | null): string | null {
  const text = value?.trim().toLowerCase()
  return text === undefined || text === '' ? null : text
}

function format(value: number): string {
  return value.toFixed(1).replace('.', ',').replace(/,0$/, '')
}
