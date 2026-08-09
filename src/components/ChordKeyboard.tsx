import { useMemo, useState } from 'react';
import type { Chord, Quality, Tension } from '../types';
import { getDegreeName, getDiatonicChords, getNoteNames, rootOffset } from '../lib/musicTheory';

type Tab = 'diatonic' | 'quality' | 'tension';

/** テンションボタンごとの巡回候補 */
const TENSION_CYCLE: Record<string, string[]> = {
  '9th': ['', '9', 'b9', '#9'],
  '11th': ['', '11', '#11'],
  '13th': ['', '13', 'b13'],
};

interface Props {
  selectedChord: Chord | null;
  projectKey: string;
  isSlotSelected: boolean;
  useDegreeNotation: boolean;
  onUpdateChord: (patch: Partial<Chord>) => void;
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '8px',
};

const cellStyle: React.CSSProperties = { padding: '15px 4px', height: 'auto' };

export default function ChordKeyboard({
  selectedChord,
  projectKey,
  isSlotSelected,
  useDegreeNotation,
  onUpdateChord,
}: Props) {
  const [tab, setTab] = useState<Tab>('diatonic');
  const [fourNote, setFourNote] = useState(false);

  const normalizedKey = useMemo(() => projectKey.replace(/m$/, ''), [projectKey]);

  if (!isSlotSelected) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100px',
          color: 'var(--text-dim)',
          border: '1px dashed var(--border)',
          borderRadius: '8px',
          margin: '10px',
        }}
      >
        拍を選択してください
      </div>
    );
  }

  const chord: Chord = selectedChord ?? {
    id: 'preview',
    root: normalizedKey,
    quality: '',
    fifth: '',
    seventh: '',
    tensions: [],
    omits: [],
    onChord: normalizedKey,
    isDimMode: false,
    isNC: false,
  };

  // --- ルート / ベース ---

  const shiftRoot = (step: number) => {
    const next = (rootOffset(chord.root || 'C') + step + 12) % 12;
    const name = getNoteNames([next + 60], projectKey, step > 0 ? 'sharp' : 'flat')[0].replace(
      /[0-9]/g,
      '',
    );
    // ルートを動かすとオンコードも同じ音に揃う
    onUpdateChord({ root: name, onChord: name, isNC: false });
  };

  const shiftBass = (step: number) => {
    const base = rootOffset(chord.onChord || chord.root || 'C');
    const next = (base + step + 12) % 12;
    const name = getNoteNames([next + 60], projectKey, step > 0 ? 'sharp' : 'flat')[0].replace(
      /[0-9]/g,
      '',
    );
    onUpdateChord({ onChord: name, isNC: false });
  };

  const rootLabel = useDegreeNotation
    ? getDegreeName(
        { ...chord, quality: '', seventh: '', fifth: '', tensions: [], omits: [], isDimMode: false },
        projectKey,
      )
    : chord.root || normalizedKey;

  const bassLabel = chord.onChord
    ? useDegreeNotation
      ? getDegreeName(
          {
            id: '',
            root: chord.onChord,
            quality: '',
            fifth: '',
            seventh: '',
            tensions: [],
            omits: [],
            onChord: '',
            isDimMode: false,
            isNC: false,
          },
          projectKey,
        )
      : chord.onChord
    : '';

  // --- クオリティ ---

  const toggleMinor = () => {
    const patch: Partial<Chord> = {
      quality: chord.quality === 'm' ? '' : 'm',
      isDimMode: false,
      isNC: false,
    };
    if (chord.seventh === 'dim7') patch.seventh = '';
    onUpdateChord(patch);
  };

  const toggleSus = () => {
    let next: Quality = 'sus4';
    if (chord.quality === '') next = 'sus4';
    else if (chord.quality === 'sus4') next = 'sus2';
    else if (chord.quality === 'sus2') next = '';

    const patch: Partial<Chord> = { quality: next, isDimMode: false, isNC: false };
    if (chord.seventh === 'dim7') patch.seventh = '';
    if (next === 'sus2' && chord.tensions?.includes('9')) {
      patch.tensions = chord.tensions.filter((t) => t !== '9');
    }
    if (next.startsWith('sus')) {
      patch.omits = (chord.omits || []).filter((o) => o !== '3rd');
    }
    onUpdateChord(patch);
  };

  const toggleAugFlat5 = () => {
    const isAug = chord.quality === 'aug';
    const isFlat5 = chord.fifth === 'b5';
    const patch: Partial<Chord> = { isDimMode: false, isNC: false };
    if (chord.seventh === 'dim7') patch.seventh = '';

    if (!isAug && !isFlat5) {
      patch.quality = 'aug';
      patch.fifth = '';
      patch.omits = (chord.omits || []).filter((o) => o !== '5th');
    } else if (isAug) {
      patch.quality = '';
      patch.fifth = 'b5';
      patch.omits = (chord.omits || []).filter((o) => o !== '5th');
    } else {
      patch.quality = chord.quality === 'm' ? 'm' : '';
      patch.fifth = '';
    }
    onUpdateChord(patch);
  };

  const toggleDim = () => {
    if (!chord.isDimMode) {
      onUpdateChord({
        isDimMode: true,
        quality: 'dim',
        seventh: '',
        fifth: '',
        tensions: [],
        omits: [],
        isNC: false,
      });
    } else if (chord.seventh !== 'dim7') {
      onUpdateChord({
        isDimMode: true,
        quality: 'dim',
        seventh: 'dim7',
        fifth: '',
        tensions: [],
        omits: [],
        isNC: false,
      });
    } else {
      onUpdateChord({ isDimMode: false, quality: '', seventh: '', isNC: false });
    }
  };

  const toggleOmit = () => {
    const omits = chord.omits || [];
    const patch: Partial<Chord> = { isNC: false };
    if (omits.includes('3rd')) {
      patch.omits = ['5th'];
      patch.quality = chord.quality === 'aug' ? '' : chord.quality;
      patch.fifth = '';
    } else if (omits.includes('5th')) {
      patch.omits = [];
    } else {
      patch.omits = ['3rd'];
      if (chord.quality === 'sus4' || chord.quality === 'sus2') patch.quality = '';
    }
    onUpdateChord(patch);
  };

  // --- テンション ---

  const cycleTension = (group: string) => {
    const options = TENSION_CYCLE[group];
    const current = (chord.tensions || []).find((t) => options.includes(t)) || '';
    const next = options[(options.indexOf(current) + 1) % options.length];

    const kept = (chord.tensions || []).filter((t) => !options.includes(t));
    if (next !== '') kept.push(next as Tension);

    const patch: Partial<Chord> = { tensions: kept, isNC: false };
    // sus2 と 9th は同じ音なので sus2 を解除する
    if (next === '9' && chord.quality === 'sus2') patch.quality = '';
    onUpdateChord(patch);
  };

  const cycleSeventh = () => {
    const next = chord.seventh === '' ? '7' : chord.seventh === '7' ? 'M7' : '';
    onUpdateChord({ seventh: next as Chord['seventh'], isNC: false });
  };

  const diatonic = getDiatonicChords(projectKey, fourNote);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {/* ルート / ベース */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '15px',
          background: 'var(--panel)',
          padding: '10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="step-btn" onClick={() => shiftRoot(-1)}>
            ♭
          </button>
          <span
            style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: 'var(--accent)',
              minWidth: '45px',
              textAlign: 'center',
            }}
          >
            {rootLabel}
          </span>
          <button className="step-btn" onClick={() => shiftRoot(1)}>
            ♯
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderLeft: '1px solid var(--border-light)',
            paddingLeft: '15px',
          }}
        >
          <button className="step-btn" onClick={() => shiftBass(-1)}>
            ♭
          </button>
          <span
            style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color:
                chord.onChord && chord.onChord !== chord.root ? '#f472b6' : 'var(--text-muted)',
              minWidth: '55px',
              textAlign: 'center',
            }}
          >
            {chord.onChord && chord.onChord !== chord.root ? `/${bassLabel}` : '/ -'}
          </span>
          <button className="step-btn" onClick={() => shiftBass(1)}>
            ♯
          </button>
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: 'flex', background: 'var(--bg)' }}>
        {(['diatonic', 'quality', 'tension'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              background: tab === t ? 'var(--panel)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : 'none',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {t === 'diatonic' ? 'ダイアトニック' : t === 'quality' ? 'クオリティ' : 'テンション'}
          </button>
        ))}
      </div>

      <div style={{ padding: '10px' }}>
        {tab === 'diatonic' && (
          <div style={gridStyle}>
            {diatonic.map((entry, i) => {
              const label = useDegreeNotation
                ? getDegreeName(
                    {
                      id: '',
                      root: entry.root,
                      quality: entry.quality,
                      fifth: entry.fifth || '',
                      seventh: entry.seventh,
                      tensions: [],
                      omits: [],
                      onChord: entry.root,
                      isDimMode: entry.quality === 'dim',
                      isNC: false,
                    },
                    projectKey,
                  )
                : `${entry.root}${entry.quality}${entry.seventh}${entry.fifth === 'b5' ? '(b5)' : ''}`;

              return (
                <button
                  key={i}
                  className="key-btn"
                  style={{ ...cellStyle, fontSize: '0.9rem' }}
                  onClick={() =>
                    onUpdateChord({
                      root: entry.root,
                      quality: entry.quality,
                      seventh: entry.seventh,
                      fifth: entry.fifth || '',
                      isDimMode: entry.quality === 'dim',
                      tensions: [],
                      omits: [],
                      onChord: entry.root,
                      isNC: false,
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
            <button
              className={`key-btn ${fourNote ? 'selected' : ''}`}
              style={{ ...cellStyle, fontSize: '0.8rem' }}
              onClick={() => setFourNote(!fourNote)}
            >
              {fourNote ? '4和音' : '3和音'}
            </button>
          </div>
        )}

        {tab === 'quality' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={gridStyle}>
              <button
                className={`key-btn ${chord.quality === 'm' ? 'selected' : ''}`}
                style={cellStyle}
                onClick={toggleMinor}
              >
                M/m
              </button>
              <button
                className={`key-btn ${chord.quality.startsWith('sus') ? 'selected' : ''}`}
                style={cellStyle}
                onClick={toggleSus}
              >
                {chord.quality.startsWith('sus') ? chord.quality : 'sus4/sus2'}
              </button>
              <button
                className={`key-btn ${
                  chord.quality !== 'dim' && (chord.quality === 'aug' || chord.fifth === 'b5')
                    ? 'selected'
                    : ''
                }`}
                style={cellStyle}
                onClick={toggleAugFlat5}
              >
                aug/b5
              </button>
              <button
                className={`key-btn ${chord.isDimMode ? 'selected' : ''}`}
                style={cellStyle}
                onClick={toggleDim}
              >
                dim/dim7
              </button>
            </div>
            <div style={gridStyle}>
              <button
                className={`key-btn ${chord.omits?.length ? 'selected' : ''}`}
                style={cellStyle}
                onClick={toggleOmit}
              >
                {chord.omits?.includes('3rd')
                  ? 'omit 3'
                  : chord.omits?.includes('5th')
                    ? 'omit 5'
                    : 'omit3/5'}
              </button>
              <button
                className={`key-btn ${
                  chord.quality === 'm' && chord.seventh === '7' && chord.fifth === 'b5'
                    ? 'selected'
                    : ''
                }`}
                style={{ ...cellStyle, fontSize: '0.8rem' }}
                onClick={() =>
                  onUpdateChord({
                    quality: 'm',
                    seventh: '7',
                    fifth: 'b5',
                    isDimMode: false,
                    omits: [],
                    isNC: false,
                  })
                }
              >
                m7(b5)
              </button>
              <button
                className="key-btn"
                style={{
                  ...cellStyle,
                  fontSize: '0.9rem',
                  background: chord.isNC ? '#f472b6' : undefined,
                }}
                onClick={() =>
                  onUpdateChord({
                    isNC: true,
                    quality: '',
                    seventh: '',
                    fifth: '',
                    tensions: [],
                    omits: [],
                    isDimMode: false,
                    onChord: '',
                  })
                }
              >
                N.C.
              </button>
            </div>
          </div>
        )}

        {tab === 'tension' && (
          <div style={gridStyle}>
            <button
              className={`key-btn ${chord.seventh ? 'selected' : ''}`}
              disabled={chord.isDimMode}
              style={{ ...cellStyle, opacity: chord.isDimMode ? 0.3 : 1 }}
              onClick={cycleSeventh}
            >
              {chord.seventh || '7th'}
            </button>
            {Object.keys(TENSION_CYCLE).map((group) => {
              const options = TENSION_CYCLE[group];
              const current = (chord.tensions || []).find((t) => options.includes(t));
              return (
                <button
                  key={group}
                  disabled={chord.isDimMode}
                  className={`key-btn ${current && !chord.isDimMode ? 'selected' : ''}`}
                  style={{ ...cellStyle, opacity: chord.isDimMode ? 0.3 : 1 }}
                  onClick={() => cycleTension(group)}
                >
                  {current || group}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
