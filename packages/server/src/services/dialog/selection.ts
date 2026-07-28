import type { Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import { getApartmentCard, parseApartmentCards, type ApartmentCard } from './apartments.js'
import { appendMessage } from './conversations.js'
import { millions, roomsSingular } from './wording.js'

/**
 * Выбор квартиры.
 *
 *   const outcome = await selectApartment(db, { conversationId, apartmentId })
 *
 * Посетитель нажал на карточке «Выбрать». Это не то же самое, что «показали»:
 * показали пять, выбрал одну — и звонить менеджер будет именно про неё.
 *
 * ── Что здесь происходит ────────────────────────────────────────────────────
 *
 *   1. карточка берётся из базы по идентификатору — тому, что прислал браузер,
 *      верить нельзя: цену в нём можно написать любую, а уедет она в CRM;
 *   2. выбор дописывается к диалогу, а не к лиду: контакта может ещё не быть,
 *      а выбор уже есть, и потерять его между кликом и формой нельзя;
 *   3. в переписку ложится реплика посетителя «Выбрал: …» — иначе следующий
 *      ход ассистента идёт мимо: человек нажал кнопку, а в контексте пусто.
 *
 * Повторный выбор той же квартиры ничего не меняет и ничего не дописывает:
 * человек нажал второй раз, потому что не понял, сработало ли, — и вторая
 * строчка «Выбрал: …» в ленте убедит его, что не сработало.
 */

/** Сколько выборов храним на диалоге. Столько квартир за один разговор не выбирают. */
const MAX_SELECTED = 20

export interface SelectApartmentInput {
  conversationId: string
  /** Идентификатор лота из карточки. */
  apartmentId: string
}

export type SelectApartmentOutcome =
  /** Лота нет или он снят с продажи. */
  | { status: 'unknown' }
  /** Эту квартиру уже выбирали в этом диалоге. */
  | { status: 'duplicate'; card: ApartmentCard; selected: ApartmentCard[] }
  | { status: 'added'; card: ApartmentCard; selected: ApartmentCard[]; text: string }

export async function selectApartment(db: Db, input: SelectApartmentInput): Promise<SelectApartmentOutcome> {
  const card = await getApartmentCard(db, input.apartmentId)
  if (card === null) return { status: 'unknown' }

  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { selectedApartments: true },
  })
  const selected = parseApartmentCards(conversation?.selectedApartments)

  if (selected.some((item) => item.id === card.id)) {
    return { status: 'duplicate', card, selected }
  }

  const next = [...selected, card].slice(-MAX_SELECTED)
  const text = describeChoice(card)

  await db.conversation.update({
    where: { id: input.conversationId },
    data: { selectedApartments: next as unknown as Prisma.InputJsonValue },
  })
  // Реплика от лица посетителя: ассистент должен читать её как сказанное им,
  // а не как служебную пометку. Карточка кладётся в то же сообщение — админка
  // показывает выбор ровно там, где он случился.
  await appendMessage(db, {
    conversationId: input.conversationId,
    role: 'user',
    content: text,
    apartments: [card],
  })

  return { status: 'added', card, selected: next, text }
}

/**
 * «Выбрал: двухкомнатная, 54,3 м², ЖК «Космос», 7-й этаж, 16,4 млн ₽».
 *
 * Пишется словами, а не полями через запятую, потому что это реплика в чате:
 * её читает и посетитель в ленте, и модель в контексте следующего хода.
 *
 * Этаж здесь не для полноты: в одном корпусе идут подряд пять лотов одной
 * площади и почти одной цены, и различает их только он. Без этажа реплика
 * «Выбрал: двухкомнатная, 52,4 м², ЖК «Берег»» повторяется дословно на каждый
 * выбор, и менеджеру нечем понять, о какой квартире речь.
 */
export function describeChoice(card: ApartmentCard): string {
  const parts: string[] = []

  const rooms = card.rooms === null ? card.planType : roomsSingular(card.rooms)
  if (rooms) parts.push(rooms)
  if (card.area) parts.push(`${card.area.toFixed(1).replace('.', ',')} м²`)
  if (card.projectName) parts.push(card.projectName)
  if (card.floor !== null) {
    parts.push(card.floorsTotal === null ? `${card.floor}-й этаж` : `${card.floor}-й этаж из ${card.floorsTotal}`)
  }
  parts.push(millions(card.price))

  return `Выбрал: ${parts.join(', ')}`
}

/** Выбранные квартиры диалога. Нужны виджету при возврате на страницу и лиду при сохранении. */
export async function listSelected(db: Db, conversationId: string): Promise<ApartmentCard[]> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { selectedApartments: true },
  })
  return parseApartmentCards(conversation?.selectedApartments)
}
