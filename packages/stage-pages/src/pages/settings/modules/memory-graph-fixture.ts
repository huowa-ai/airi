import type { MemoryGraphAtom, MemoryGraphCore, MemoryGraphFact, MemoryGraphScene } from './memory-graph-model'

/**
 * Example records in the shape of one MemoryCore user.
 * Counts match a live read: 16 L0 facts, 11 L1 atoms, 1 L2 scene, and 1 L3 persona.
 * The text is fixture copy. It is not a person's memory.
 */
const factRows: Array<[string, string, string?]> = [
  ['Afternoon tea', 'Ada drinks tea in the afternoon.', 'card-1'],
  ['Water', 'Ada drinks water with lunch.'],
  ['Quiet morning', 'The morning starts without a meeting.'],
  ['红茶', '下午喝红茶。'],
  ['Walk', 'A short walk follows lunch.'],
  ['Notes', 'Notes stay in the example notebook.'],
  ['Music', 'Piano music plays in the evening.'],
  ['Rain', 'Rain means tea stays hot.'],
  ['Books', 'One chapter is enough at night.'],
  ['Garden', 'The garden needs water on dry days.'],
  ['Market', 'The market trip is on Saturday.'],
  ['Letters', 'Letters get a short reply.'],
  ['Soup', 'Soup is the cold-day meal.'],
  ['Lamp', 'The lamp stays warm and dim.'],
  ['Window', 'The window opens when the air is clear.'],
  ['Rest', 'Rest starts after the last note.'],
]

const atomRows: Array<[string, string, string?]> = [
  ['instruction', '回答时先提饮品。', '来自饮品对话。'],
  ['persona', 'The owner uses the example name Yumeka.'],
  ['instruction', 'Keep replies short in the evening.'],
  ['persona', 'Ada prefers tea to coffee.'],
  ['instruction', 'Mention the garden after dry weather.'],
  ['persona', '周末去市场。'],
  ['instruction', 'Do not invent a second name.'],
  ['persona', 'Piano music marks the evening.'],
  ['instruction', 'Offer water with lunch.'],
  ['persona', 'Rain keeps the tea hot.'],
  ['instruction', 'Close the day after the last note.'],
]

const personaBody = [
  '# Calm companion',
  '',
  'This fixture profile is example text for the graph.',
  '',
  '## Drinks',
  '',
  'Tea in the afternoon. Water with lunch.',
  '',
  '## 名字',
  '',
  '例子里的主人叫 Yumeka。',
  '',
  '## Notes',
  '',
  `${'This fixture line is example text for the persona view. '.repeat(12)}`,
].join('\n')

export const memoryGraphFixture: {
  facts: MemoryGraphFact[]
  atoms: MemoryGraphAtom[]
  scenes: MemoryGraphScene[]
  cores: MemoryGraphCore[]
} = {
  facts: factRows.map(([description, body, persona], index) => ({
    id: `fact-${index + 1}`,
    description,
    body,
    updatedAt: index + 1,
    ...(persona ? { persona } : {}),
  })),
  atoms: atomRows.map(([type, content, background], index) => ({
    id: `atom-${index + 1}`,
    type,
    content,
    updatedAt: 100 + index,
    ...(background ? { background } : {}),
  })),
  scenes: [{
    path: 'drinks.md',
    summary: 'Drink habits',
    content: 'Tea in the afternoon and water with lunch.',
    updatedAt: 200,
  }],
  cores: [{
    content: personaBody,
    updatedAt: 300,
  }],
}
