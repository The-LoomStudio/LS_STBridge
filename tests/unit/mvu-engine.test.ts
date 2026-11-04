import { describe, expect, it } from 'vitest'
import { initializeMvuData, updateMvuData } from '../../src/runtime/mvu-engine.js'

function initial(content = 'hp: [10, health]\nitems: ["$__META_EXTENSIBLE__$"]') {
  return initializeMvuData({ opening: '', resources: [{
    id: 'primary', name: 'World', metadata: { stPrimaryWorldbook: true },
    entries: [{ id: 'init', label: '[initvar]', content, enabled: false }],
  }] }).value
}

describe('MVU data engine', () => {
  it('uses disabled init entries and preserves value-with-description updates and aliases', async () => {
    const before = initial()
    const updated = await updateMvuData("_.add('hp', -3); _.assign('items', 'sword');", before)
    expect(updated.diagnostics).toEqual([])
    expect(updated.value.stat_data).toEqual({ hp: [7, 'health'], items: ['sword'] })
    expect(before.stat_data).toEqual({ hp: [10, 'health'], items: [] })
    expect(updated.value.initialized_lorebooks).toEqual({ primary: [] })
  })

  it('uses opening initvar instead of the primary book, retaining additional books', () => {
    const value = initializeMvuData({
      opening: '<initvar>\n```yaml\nhp: 20\n```\n</initvar>',
      resources: [
        { id: 'a', name: 'Same', metadata: { stPrimaryWorldbook: true }, entries: [
          { id: '1', label: '[initvar]', content: 'hp: 5\nprimaryOnly: true', enabled: false },
        ] },
        { id: 'b', name: 'Same', entries: [
          { id: '2', label: '[initvar]', content: 'hp: 4\nweather: rain', enabled: true },
        ] },
      ],
    }).value
    expect(value.stat_data).toEqual({ hp: 20, weather: 'rain' })
    expect(value.initialized_lorebooks).toEqual({ a: [], b: [] })
  })

  it('retains dynamic schema extensibility, math expressions and JSONPatch updates', async () => {
    const before = initial('$meta:\n  extensible: true\nhp: 10')
    const first = await updateMvuData("_.set('hp', Math.floor(9.8)); _.insert('', 'gold', 4);", before)
    expect(first.value.stat_data).toMatchObject({ hp: 9, gold: 4 })
    const second = await updateMvuData('<JSONPatch>[{"op":"delta","path":"/gold","value":3}]</JSONPatch>', first.value)
    expect(second.value.stat_data).toMatchObject({ gold: 7 })
  })

  it('reports rejected commands and rejects malformed init, patches and prototype paths', async () => {
    const rejected = await updateMvuData("_.add('missing', 1);", initial())
    expect(rejected.diagnostics.length).toBeGreaterThan(0)
    expect(() => initial('[')).toThrow()
    await expect(updateMvuData('<JSONPatch>{}</JSONPatch>', initial())).rejects.toThrow('Invalid MVU JSONPatch')
    await expect(updateMvuData("_.set('__proto__.polluted', true);", initial())).rejects.toThrow('Unsafe MVU path')
    await expect(updateMvuData("_.insert('items', {'__proto__':{polluted:true}});", initial())).rejects.toThrow()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
