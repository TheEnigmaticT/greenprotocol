import { describe, expect, it } from 'vitest'
import {
  assemblePages,
  cleanPdfPages,
  collectWords,
  normalizeCharacters,
  reflowLines,
  removePageFurniture,
  startsNewBlock,
  stripPageMarkers,
} from '@/lib/pdf-import/clean'

function reflow(text: string, evidence = text): string {
  return reflowLines(text.split('\n'), collectWords(evidence.split('\n'))).join('\n')
}

const digitsOf = (text: string) => text.replace(/\D/g, '')

describe('normalizeCharacters', () => {
  it('expands ligatures so searches and names read normally', () => {
    expect(normalizeCharacters('\uFB01ltered, \uFB02ask, e\uFB00ort, di\uFB03cult, ba\uFB04e')).toBe(
      'filtered, flask, effort, difficult, baffle',
    )
  })

  it('turns non-breaking and thin spaces into plain spaces without dropping the unit', () => {
    expect(normalizeCharacters('25\u00A0mL, 3.5\u202Fg, 10\u2009mmol')).toBe('25 mL, 3.5 g, 10 mmol')
  })

  it('normalizes Windows, old-Mac and Unicode line endings', () => {
    expect(normalizeCharacters('a\r\nb\rc\u2028d\u2029e')).toBe('a\nb\nc\nd\ne')
  })

  it('keeps a soft hyphen at the end of a line as the visible hyphen and drops it elsewhere', () => {
    expect(normalizeCharacters('tem\u00AD\nperature, hy\u00ADdrogen')).toBe('tem-\nperature, hydrogen')
  })

  it('removes zero-width characters and control characters', () => {
    expect(normalizeCharacters('Na\u200BOH\uFEFF\u0000')).toBe('NaOH')
  })

  it('leaves degrees, micro, minus, Greek and superscript characters untouched', () => {
    const text = '25 \u00B0C, 5 \u00B5L, \u221278 \u00B0C, \u0394T, 10\u207B\u00B3 M, CO\u2082'
    expect(normalizeCharacters(text)).toBe(text)
  })
})

describe('startsNewBlock', () => {
  it.each([
    '1. A flask was charged',
    '12) Stir for 5 min',
    '(3) Filter the solid',
    'Step 2',
    'Step 2: Add the base',
    'a) First, cool the mixture',
    'iv. Wash the organic layer',
    '- Waste was collected',
    '\u2022 Keep under nitrogen',
    'General procedure for the coupling',
    'Procedure A',
    'Experimental',
    'Notes',
  ])('recognizes %j', (line) => {
    expect(startsNewBlock(line)).toBe(true)
  })

  it.each([
    '10.0 mmol) was added slowly',
    '25 mL of toluene',
    'and the mixture was stirred',
    'procedure was repeated twice',
    '(1.85 g, 88%).',
    'e.g. ethyl acetate',
    'Stepwise addition of the base',
  ])('does not treat %j as a new block', (line) => {
    expect(startsNewBlock(line)).toBe(false)
  })
})

describe('reflowLines', () => {
  it('joins a hard-wrapped paragraph into one line', () => {
    const wrapped = [
      'The reaction mixture was stirred at room temperature for 12 h and then filtered through',
      'a pad of Celite. The filtrate was concentrated under reduced pressure to give a pale',
      'yellow oil.',
    ].join('\n')
    expect(reflow(wrapped)).toBe(
      'The reaction mixture was stirred at room temperature for 12 h and then filtered through a pad of Celite. The filtrate was concentrated under reduced pressure to give a pale yellow oil.',
    )
  })

  it('keeps numbered steps, "Step N" and headings on their own lines while joining their wrapped text', () => {
    const page = [
      'General procedure',
      '1. Benzoic acid (1.22 g, 10.0 mmol) was dissolved in dichloromethane (20 mL) and cooled to',
      '0 \u00B0C under nitrogen.',
      '2. Oxalyl chloride (1.0 mL, 11.7 mmol) was added dropwise over 5 min, followed by DMF (2',
      'drops).',
      'Step 3',
      'The mixture was warmed to 25 \u00B0C and stirred for 2 h until gas evolution ceased and the',
      'solution turned clear.',
    ].join('\n')
    expect(reflow(page).split('\n')).toEqual([
      'General procedure',
      '1. Benzoic acid (1.22 g, 10.0 mmol) was dissolved in dichloromethane (20 mL) and cooled to 0 \u00B0C under nitrogen.',
      '2. Oxalyl chloride (1.0 mL, 11.7 mmol) was added dropwise over 5 min, followed by DMF (2 drops).',
      'Step 3',
      'The mixture was warmed to 25 \u00B0C and stirred for 2 h until gas evolution ceased and the solution turned clear.',
    ])
  })

  it('keeps bullet items separate and joins a bullet\u2019s own continuation line', () => {
    const page = [
      'Safety notes for the work-up of large batches in the pilot plant and the laboratory:',
      '- Quench slowly: the aqueous sodium bicarbonate evolves carbon dioxide vigorously and can',
      'overflow the vessel.',
      '- Keep halogenated waste separate from the non-halogenated solvent container at all times.',
    ].join('\n')
    expect(reflow(page).split('\n')).toEqual([
      'Safety notes for the work-up of large batches in the pilot plant and the laboratory:',
      '- Quench slowly: the aqueous sodium bicarbonate evolves carbon dioxide vigorously and can overflow the vessel.',
      '- Keep halogenated waste separate from the non-halogenated solvent container at all times.',
    ])
  })

  it('preserves blank lines between paragraphs but collapses runs of them', () => {
    const page = ['First paragraph ends here.', '', '', '', 'Second paragraph starts here.'].join('\n')
    expect(reflow(page)).toBe('First paragraph ends here.\n\nSecond paragraph starts here.')
  })

  it('does not merge a short last line of a paragraph into the paragraph that follows', () => {
    const page = [
      'Synthesis of N-benzylbenzamide',
      'A 100 mL round-bottom flask was charged with benzoic acid (1.22 g, 10.0 mmol) and stirred briefly.',
      'The solution turned clear.',
      'The product was obtained as a white solid and characterised by NMR spectroscopy, and all data matched.',
    ].join('\n')
    expect(reflow(page).split('\n')).toEqual([
      'Synthesis of N-benzylbenzamide',
      'A 100 mL round-bottom flask was charged with benzoic acid (1.22 g, 10.0 mmol) and stirred briefly. The solution turned clear.',
      'The product was obtained as a white solid and characterised by NMR spectroscopy, and all data matched.',
    ])
  })

  it('joins a line that stops short mid-sentence when the next line continues in lowercase', () => {
    const page = [
      'Both layers were separated and the aqueous phase was extracted three times with ethyl acetate',
      'and the combined extracts were washed twice with water',
      'with brine and dried over sodium sulfate before concentration under reduced pressure.',
    ].join('\n')
    expect(reflow(page).split('\n')).toHaveLength(1)
  })

  it('returns nothing for an empty page', () => {
    expect(reflowLines([], new Set())).toEqual([])
    expect(reflowLines(['', ''], new Set())).toEqual([])
  })

  describe('line-end hyphens', () => {
    const body = (breakAt: string) =>
      [`A solution of the starting material in ${breakAt}`, 'was stirred at reflux for several hours until the reaction was complete by TLC.'].join('\n')

    it('removes the hyphen from an ordinary word broken by typesetting', () => {
      expect(reflow(body('tem-\nperature'))).toContain('temperature')
      expect(reflow('The mixture was stirred at room tem-\nperature for 12 hours until clear.\nIt was filtered.')).toContain(
        'room temperature for 12 hours',
      )
    })

    it.each([
      ['N-\nmethylpyrrolidone', 'N-methylpyrrolidone'],
      ['tert-\nbutyl methyl ether', 'tert-butyl methyl ether'],
      ['1,2-\ndichloroethane', '1,2-dichloroethane'],
      ['(S)-\nproline', '(S)-proline'],
      ['2-methyl-\n1-butanol', '2-methyl-1-butanol'],
      ['DMF-\nbased', 'DMF-based'],
      ['cis-\ndecalin', 'cis-decalin'],
    ])('keeps the hyphen in the chemical name %j', (broken, expected) => {
      expect(reflow(`Dissolve the substrate (5 mmol) in ${broken} and stir.`)).toBe(
        `Dissolve the substrate (5 mmol) in ${expected} and stir.`,
      )
    })

    it('keeps the hyphen in common compounds such as room-temperature and ice-cold', () => {
      expect(reflow('Add the solution at room-\ntemperature and then ice-\ncold water.')).toBe(
        'Add the solution at room-temperature and then ice-cold water.',
      )
    })

    it('uses the rest of the document to decide an ambiguous compound', () => {
      const hyphenated = 'The water-soluble salt dissolved. Later the product was water-\nsoluble as expected and filtered.'
      expect(reflow(hyphenated)).toContain('water-soluble as expected')

      const plain = 'A mild ab-\nsorbed dose was noted; the absorbed fraction was low and the mixture was filtered.'
      expect(reflow(plain)).toContain('mild absorbed dose')
    })

    it('does not touch a trailing hyphen that is not followed by a continuation (dash at end of paragraph)', () => {
      expect(reflow('Dissolve in water -\n\nNext paragraph.')).toBe('Dissolve in water -\n\nNext paragraph.')
    })
  })
})

describe('removePageFurniture', () => {
  const pageWith = (body: string[], header: string, footer: string) => [header, '', ...body, '', footer]

  it('removes a running header and footer that repeat on most pages, ignoring the page digits', () => {
    const pages = ['alpha', 'bravo', 'charlie', 'delta'].map((word, n) =>
      pageWith(
        [`Opening line about ${word}`, `Second line about ${word}s`, 'Third line shared by every page', `Fourth line about ${word}`, `Fifth line about ${word}`, `Sixth line about ${word}`],
        'Org. Process Res. Dev. 2024, 28, 1123',
        `Supporting Information S${n + 1}`,
      ),
    )
    const { pages: kept, removed } = removePageFurniture(pages)
    for (const page of kept) {
      expect(page.join('\n')).not.toContain('Org. Process')
      expect(page.join('\n')).not.toContain('Supporting Information')
      expect(page.join('\n')).toContain('Third line shared by every page')
    }
    expect(removed).toHaveLength(8)
  })

  it('keeps a repeated line that appears on fewer than three pages or less than half of them', () => {
    const pages = [1, 2, 3, 4, 5, 6].map((n) =>
      pageWith(['Unique body ' + n, 'More body text here'], n <= 2 ? 'Confidential draft' : `Heading for part ${n}`, `Footer note ${n * 7}`),
    )
    const joined = removePageFurniture(pages).pages.flat().join('\n')
    expect(joined).toContain('Confidential draft')
  })

  it('removes a consistent run of bare page numbers at the page edges', () => {
    const pages = [
      ['Charge the flask with the substrate', 'Add the solvent slowly', '3'],
      ['Warm the mixture gently to dissolve', 'Hold at temperature for a while', '4'],
      ['Cool and filter the resulting solid', 'Dry under vacuum overnight', '5'],
    ]
    const { pages: kept } = removePageFurniture(pages)
    expect(kept.map((page) => page.length)).toEqual([2, 2, 2])
  })

  it('does not treat an isolated number as a page number when it breaks the sequence', () => {
    const pages = [
      ['Stir the mixture and record the temperature', 'Final reading', '25'],
      ['Second page of text with enough words', 'Another observation', '9'],
      ['Third page of text with enough words', 'More observations', '77'],
    ]
    expect(removePageFurniture(pages).pages.map((page) => page.length)).toEqual([3, 3, 3])
  })

  it('keeps a lone trailing number on a one-page PDF', () => {
    const { pages } = removePageFurniture([['Stir the mixture at the stated temperature', 'Record the value', '25']])
    expect(pages[0]).toContain('25')
  })

  it('removes explicit "Page N of M" and "- N -" forms', () => {
    const pages = [
      ['Body text of page one goes here', 'More text', 'Page 1 of 2'],
      ['Body text of page two goes here', 'More text', '- 2 -'],
    ]
    expect(removePageFurniture(pages).pages.flat().join('\n')).not.toMatch(/Page 1 of 2|- 2 -/)
  })

  it('never removes numbered procedure steps that sit at the top of many pages', () => {
    const pages = Array.from({ length: 6 }, () => ['1. Stir the mixture for 5 min at 25 \u00B0C.', 'Wait.'])
    expect(removePageFurniture(pages).pages.flat().filter((line) => line.startsWith('1.'))).toHaveLength(6)
  })
})

describe('cleanPdfPages on a messy supporting-information excerpt', () => {
  // Three pages as a PDF text layer typically yields: CRLF, NBSP before units, ligatures, wrapped lines,
  // hyphenated breaks, a running header with the page number, a bare page number footer.
  const header = 'Supporting Information for J. Org. Chem. 2024, 89, 1123'
  const raw = [
    [
      header,
      '',
      'General  procedure for the preparation of amides',
      '',
      '1. A 100\u00A0mL round-bottom \uFB02ask was charged with benzoic acid (1.22 g, 10.0\u00A0mmol), N-',
      'methylpyrrolidone (20\u00A0mL) and a stir bar. The mixture was stirred at room tem-',
      'perature until a clear solution formed.',
      '2. Benzylamine (1.18 g, 11.0 mmol) was added dropwise over 5 min at 0 degrees C.',
      '1',
    ].join('\r\n'),
    [
      header,
      '',
      '3. EDC hydrochloride (2.30 g, 12.0\u00A0mmol) was added in one portion, the cooling bath was re-',
      'moved and the reaction was stirred for 12 h at 25 \u00B0C.',
      'Step 4',
      'The crude \uFB01ltrate was concentrated and puri\uFB01ed by column chromatography (SiO2, 3:1 hex-',
      'anes/EtOAc) to give the amide (1.85 g, 88%).',
      '2',
    ].join('\r\n'),
    [header, '', '- Waste: aqueous layers were combined.', '- Solvent: halogenated waste kept separate.', '3'].join('\r\n'),
  ]

  const { pages, removedLines } = cleanPdfPages(raw)

  it('drops the running header and page numbers but nothing else', () => {
    expect(removedLines).toHaveLength(6)
    expect(pages.join('\n')).not.toContain('Supporting Information')
  })

  it('produces readable, correctly joined steps', () => {
    expect(pages[0].split('\n')).toEqual([
      'General procedure for the preparation of amides',
      '',
      '1. A 100 mL round-bottom flask was charged with benzoic acid (1.22 g, 10.0 mmol), N-methylpyrrolidone (20 mL) and a stir bar. The mixture was stirred at room temperature until a clear solution formed.',
      '2. Benzylamine (1.18 g, 11.0 mmol) was added dropwise over 5 min at 0 degrees C.',
    ])
    expect(pages[1].split('\n')).toEqual([
      '3. EDC hydrochloride (2.30 g, 12.0 mmol) was added in one portion, the cooling bath was removed and the reaction was stirred for 12 h at 25 \u00B0C.',
      'Step 4',
      'The crude filtrate was concentrated and purified by column chromatography (SiO2, 3:1 hexanes/EtOAc) to give the amide (1.85 g, 88%).',
    ])
    expect(pages[2].split('\n')).toEqual(['- Waste: aqueous layers were combined.', '- Solvent: halogenated waste kept separate.'])
  })

  it('never changes any number: the digits of the output are exactly those of the body text', () => {
    const body = raw.map((page) => page.split('\r\n').filter((line) => line !== header && !/^\d$/.test(line)).join('\n'))
    expect(digitsOf(pages.join('\n'))).toBe(digitsOf(body.join('\n')))
    for (const token of ['100 mL', '1.22 g', '10.0 mmol', '2.30 g', '12.0 mmol', '25 \u00B0C', '3:1', '1.85 g', '88%', '0 degrees C']) {
      expect(pages.join('\n')).toContain(token)
    }
  })

  it('keeps the order of the text', () => {
    const joined = pages.join('\n')
    const order = ['General procedure', '1. A 100 mL', '2. Benzylamine', '3. EDC', 'Step 4', '- Waste', '- Solvent']
    const positions = order.map((marker) => joined.indexOf(marker))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions.every((position) => position >= 0)).toBe(true)
  })
})

describe('invariants on text without page furniture', () => {
  it('keeps every digit, in order, when cleaning a block of mixed units and ratios', () => {
    const page = [
      'Cool to \u221278 \u00B0C (dry ice/acetone), add n-BuLi (2.5 M in hexanes, 4.4 mL, 11 mmol) dropwise',
      'over 10 min, then stir 30 min. Quench with sat. aq. NH4Cl (10 mL), warm to 23 \u00B0C and extract with',
      'Et2O (3 \u00D7 25 mL). Rf = 0.35 (hexanes/EtOAc 4:1); mp 112\u2013114 \u00B0C; [\u03B1]D25 +12.5 (c 1.0, CHCl3).',
    ]
    const { pages } = cleanPdfPages([page.join('\n')])
    expect(digitsOf(pages[0])).toBe(digitsOf(page.join('\n')))
    for (const token of ['\u221278 \u00B0C', '2.5 M', '4.4 mL', '4:1', '112\u2013114 \u00B0C', '3 \u00D7 25 mL']) {
      expect(pages[0]).toContain(token)
    }
  })
})

describe('assemblePages and stripPageMarkers', () => {
  it('adds a [p. N] marker above each page of a multi-page document', () => {
    const text = assemblePages(['Page one text that is long enough.', 'Page two text that is long enough.'])
    expect(text).toBe('[p. 1]\nPage one text that is long enough.\n\n[p. 2]\nPage two text that is long enough.')
  })

  it('adds no marker to a one-page document', () => {
    expect(assemblePages(['Only page text.'])).toBe('Only page text.')
  })

  it('flags pages with no usable text in place', () => {
    const text = assemblePages(['Page one text that is long enough.', '', 'Page three text that is long enough.'])
    expect(text).toContain('[p. 2: no text found on this page]')
  })

  it('stripPageMarkers removes only the markers and returns the original text', () => {
    const pages = ['1. First step of the procedure is here.', '', '2. Second step of the procedure is here.']
    const assembled = assemblePages(pages)
    expect(stripPageMarkers(assembled)).toBe('1. First step of the procedure is here.\n\n2. Second step of the procedure is here.')
  })

  it('does not remove a user-typed line that merely resembles a marker', () => {
    expect(stripPageMarkers('[p. x]\nKeep [p. 3] inline')).toBe('[p. x]\nKeep [p. 3] inline')
  })
})
