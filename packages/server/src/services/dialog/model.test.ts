import { describe, expect, it } from 'vitest'

import { chooseModel, escalationReason } from './model.js'

/**
 * Выбор модели — чистая функция от текста запроса, базы здесь не нужно.
 */

const MODELS = { default: 'claude-haiku-4-5-20251001', escalation: 'claude-sonnet-5' }

describe('chooseModel', () => {
  it('простой запрос идёт на основную модель', () => {
    const choice = chooseModel('Двушка до 18 млн', MODELS)

    expect(choice).toEqual({ model: MODELS.default, escalated: false, reason: null })
  })

  it('сравнение ЖК поднимает на старшую модель', () => {
    const choice = chooseModel('Сравните эти два ЖК по срокам сдачи', MODELS)

    expect(choice.model).toBe(MODELS.escalation)
    expect(choice.escalated).toBe(true)
    expect(choice.reason).toBe('сравнение')
  })

  it('вопрос к базе знаний поднимает на старшую модель', () => {
    expect(chooseModel('Есть ли рассрочка без процентов?', MODELS).model).toBe(MODELS.escalation)
    expect(chooseModel('Какая ставка по семейной ипотеке?', MODELS).model).toBe(MODELS.escalation)
  })

  it('многокритериальный подбор поднимает на старшую модель', () => {
    const choice = chooseModel('Двушка до 18 млн рядом с метро, сдача в 2027', MODELS)

    expect(choice.model).toBe(MODELS.escalation)
    expect(choice.reason).toContain('много критериев')
  })

  it('пустая настройка эскалации оставляет основную модель', () => {
    const choice = chooseModel('Сравните два ЖК', { default: MODELS.default, escalation: '  ' })

    expect(choice).toEqual({ model: MODELS.default, escalated: false, reason: null })
  })

  it('одинаковые модели в настройках не считаются эскалацией', () => {
    const choice = chooseModel('Сравните два ЖК', { default: MODELS.default, escalation: MODELS.default })

    expect(choice.escalated).toBe(false)
  })
})

describe('escalationReason', () => {
  it('двух признаков подбора мало', () => {
    expect(escalationReason('Двушка до 18 млн')).toBeNull()
  })

  it('длинный рассказ о ситуации разбирает старшая модель', () => {
    const story =
      'Мы с женой продаём квартиру родителей и хотим переехать поближе к её работе, ' +
      'сейчас снимаем и платим примерно столько же, сколько был бы платёж, ' +
      'поэтому думаем не тянуть и посмотреть варианты уже сейчас, но пока сомневаемся и хотим понять, с чего начать.'

    expect(escalationReason(story)).toBe('длинный запрос')
  })

  it('пустое сообщение не эскалируется', () => {
    expect(escalationReason('   ')).toBeNull()
  })
})
